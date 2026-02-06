/**
 * 가사 평문을 Gemini에 넘겨, 토크나이징과 단어 선정을 모두 Gemini가 수행해 단어장을 생성하는 모듈.
 * lib/gemini.generateText 스트리밍 API 사용.
 */

import { generateText as streamGeminiText, generateStructured } from "./lib/gemini";
import type { GeminiEnv } from "./lib/gemini";
import * as z from "zod";

export type VocabularyLanguage = "en" | "ko";

export type VocabularyLevel = "beginner" | "intermediate" | "advanced";

export interface VocabularyOptions {
    language: VocabularyLanguage;
    maxWords?: number;
    minLength?: number;
    level?: VocabularyLevel;
}

export interface VocabularyEntry {
    word: string;
    score?: number;
    meaning?: string;
    example?: string;
    /** 유의어 목록. Gemini 생성, word_synonyms에 저장 */
    synonyms?: string[];
    /** 이번 분석에서 해당 단어가 나온 횟수. user_words count 누적용(기본 1) */
    occurrences?: number;
    /** 단어가 추출된 곡 정보 (클라이언트 반환용) */
    songTitle?: string;
    songArtist?: string;
}

export interface VocabularyEnv {
    GEMINI_API_KEY: string;
    GEMINI_MODEL?: string;
    GEMINI_BASE_URL?: string;
}

export interface UserVocabularySettingsRow {
    language: string;
    level: string;
    max_words: number;
    min_length: number;
}

/** 사용자 기준 단어장 DB 저장 시 넘길 payload */
export interface SaveVocabularyPayload {
    userId: string;
    entries: VocabularyEntry[];
    title?: string;
}

export interface VocabularyEnvWithDb extends VocabularyEnv {
    getVocabularySettings?(userId: string): Promise<UserVocabularySettingsRow | null>;
    /** 있으면 생성된 단어장을 사용자 기준으로 DB에 저장 */
    saveVocabularyList?(payload: SaveVocabularyPayload): Promise<void>;
}

export const DEFAULT_VOCABULARY_OPTIONS: VocabularyOptions = {
    language: "en",
    level: "intermediate",
    maxWords: 30,
    minLength: 2,
};

function toGeminiEnv(env: VocabularyEnv): GeminiEnv {
    return {
        SECRET_GEMINI_API_KEY: env.GEMINI_API_KEY,
        GEMINI_MODEL: env.GEMINI_MODEL,
        GEMINI_BASE_URL: env.GEMINI_BASE_URL,
    };
}

function getLevelInstruction(level: VocabularyLevel): string {
    switch (level) {
        case "beginner":
            return "Target level: beginner. Prefer high-frequency, essential words. Give short, simple definitions and easy example phrases.";
        case "advanced":
            return "Target level: advanced. Include less common words, idioms, or phrasal verbs where they appear. Definitions can be more precise or nuanced.";
        default:
            return "Target level: intermediate. Mix common and some less common words. Use clear definitions and example phrases from the lyrics.";
    }
}

function buildVocabularyPrompt(lyrics: string, options: VocabularyOptions): string {
    const { language, maxWords = 30, minLength = 2, level = "intermediate" } = options;
    const langLabel = language === "en" ? "English" : "Korean";
    const levelInstruction = getLevelInstruction(level);

    return [
        "You are a vocabulary tutor. Below are song lyrics in plain text.",
        "",
        levelInstruction,
        "",
        "Tasks (do all yourself):",
        `1. Tokenize: split the text into words. For ${langLabel}, normalize appropriately (e.g. lowercase for English, strip punctuation).`,
        `2. Filter: ignore words shorter than ${minLength} characters and common stop words (articles, pronouns, conjunctions, etc.).`,
        `3. Select: choose at most ${maxWords} words that are most useful for vocabulary memorization at the target level above.`,
        "",
        '4. Synonyms: for each selected word, add "synonyms" (array of 1–5 synonym words in the same language, useful for vocabulary learning).',
        "",
        'Output: Return a single JSON array. Each element must have: "word" (string), "score" (number 1–10, importance), "meaning" (short definition in Korean only), "example" (short phrase from or inspired by the lyrics), "synonyms" (array of strings). No markdown, no explanation—only the JSON array.',
        "",
        "--- Lyrics ---",
        lyrics,
    ].join("\n");
}

function parseVocabularyResponse(
    text: string,
    maxWords: number,
    minLength: number
): VocabularyEntry[] {
    const trimmed = text.trim();

    // Extract JSON array more robustly - find matching brackets
    let jsonStr = trimmed;
    const firstBracket = trimmed.indexOf('[');
    if (firstBracket !== -1) {
        // Find matching closing bracket
        let depth = 0;
        for (let i = firstBracket; i < trimmed.length; i++) {
            if (trimmed[i] === '[') depth++;
            else if (trimmed[i] === ']') depth--;
            if (depth === 0) {
                jsonStr = trimmed.substring(firstBracket, i + 1);
                break;
            }
        }
    }

    let list: VocabularyEntry[];
    try {
        list = JSON.parse(jsonStr) as VocabularyEntry[];
    } catch (e) {
        console.error("JSON parse error:", e);
        console.error("Tried to parse:", jsonStr.substring(0, 500));
        throw new Error("Gemini returned invalid JSON for vocabulary");
    }

    if (!Array.isArray(list)) return [];

    const normalized = list
        .filter(
            (e): e is VocabularyEntry =>
                e != null &&
                typeof e === "object" &&
                typeof (e as VocabularyEntry).word === "string"
        )
        .map((e) => {
            const raw = e as VocabularyEntry & { synonyms?: unknown };
            let synonyms: string[] | undefined;
            if (Array.isArray(raw.synonyms)) {
                synonyms = raw.synonyms
                    .filter((s): s is string => typeof s === "string")
                    .map((s) => String(s).trim())
                    .filter((s) => s.length > 0);
                if (synonyms.length === 0) synonyms = undefined;
            }
            return {
                word: String(raw.word).trim(),
                score: typeof raw.score === "number" ? raw.score : undefined,
                meaning: typeof raw.meaning === "string" ? raw.meaning : undefined,
                example: typeof raw.example === "string" ? raw.example : undefined,
                synonyms,
            };
        })
        .filter((e) => e.word.length >= minLength);

    const countByWord = new Map<string, number>();
    for (const e of normalized) {
        const key = e.word.toLowerCase();
        countByWord.set(key, (countByWord.get(key) ?? 0) + 1);
    }

    const seen = new Set<string>();
    return normalized
        .filter((e) => {
            const key = e.word.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .map((e) => ({
            ...e,
            occurrences: countByWord.get(e.word.toLowerCase()) ?? 1,
        }))
        .slice(0, maxWords);
}

function rowToOptions(row: UserVocabularySettingsRow): VocabularyOptions {
    const lang: VocabularyLanguage = row.language === "ko" ? "ko" : "en";
    const lv: VocabularyLevel =
        row.level === "beginner"
            ? "beginner"
            : row.level === "advanced"
              ? "advanced"
              : "intermediate";
    const maxWords = Number(row.max_words);
    const minLength = Number(row.min_length);
    return {
        language: lang,
        level: lv,
        maxWords:
            Number.isFinite(maxWords) && maxWords >= 1 && maxWords <= 200
                ? maxWords
                : DEFAULT_VOCABULARY_OPTIONS.maxWords,
        minLength:
            Number.isFinite(minLength) && minLength >= 1 && minLength <= 20
                ? minLength
                : DEFAULT_VOCABULARY_OPTIONS.minLength,
    };
}

export async function getVocabularyOptionsForUser(
    userId: string,
    getSettings: (userId: string) => Promise<UserVocabularySettingsRow | null>
): Promise<VocabularyOptions> {
    const row = await getSettings(userId);
    return row ? rowToOptions(row) : { ...DEFAULT_VOCABULARY_OPTIONS };
}

/**
 * 가사 평문을 Gemini에 넘겨 단어장 생성. lib/gemini.generateText 스트리밍 사용.
 */
export async function createVocabularyFromLyrics(
    lyrics: string,
    options: VocabularyOptions,
    env: VocabularyEnv
): Promise<VocabularyEntry[]> {
    if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required in env");

    const { maxWords = 30, minLength = 2 } = options;
    const prompt = buildVocabularyPrompt(lyrics, options);
    const geminiEnv = toGeminiEnv(env);

    try {
        // Approach 1: Streaming text with JSON parsing
        let fullText = "";
        for await (const chunk of streamGeminiText(prompt, geminiEnv)) {
            fullText += chunk;
        }
        return parseVocabularyResponse(fullText, maxWords, minLength);
    } catch (e: unknown) {
        console.error("Gemini streaming error:", e);

        // Approach 2: Try structured output
        try {
            const itemSchema = z.object({
                word: z.string(),
                score: z.number().optional(),
                meaning: z.string().optional(),
                example: z.string().optional(),
                synonyms: z.array(z.string()).optional(),
            });
            // generateStructured는 ZodObject만 받으므로 배열을 객체로 감싸기
            const listSchema = z.object({
                items: z.array(itemSchema),
            });
            const result = await generateStructured(prompt, listSchema, geminiEnv);

            const normalized = (result.items ?? [])
                .filter((e: unknown) => e && typeof e === "object" && (e as { word?: string }).word && (e as { word: string }).word.length >= minLength)
                .map((e: unknown) => ({
                    ...(e as VocabularyEntry),
                    word: (e as { word: string }).word.trim(),
                    occurrences: 1,
                }))
                .slice(0, maxWords);

            return normalized as VocabularyEntry[];
        } catch (e2: unknown) {
            console.error("Gemini structured error:", e2);
            // Fallback
            return getFallbackVocabulary(lyrics, maxWords, minLength);
        }
    }
}

/** Fallback vocabulary when Gemini API fails */
function getFallbackVocabulary(lyrics: string, maxWords: number, minLength: number): VocabularyEntry[] {
    const words = lyrics
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= minLength)
        .filter(w => !isStopWord(w));

    const uniqueWords = [...new Set(words)].slice(0, maxWords);

    return uniqueWords.map(word => ({
        word,
        score: 5,
        meaning: "단어 정의",
        example: "가사에서 추출된 단어",
        synonyms: [],
        occurrences: 1,
    }));
}

/** Simple stopword check */
function isStopWord(word: string): boolean {
    const stops = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'and', 'or', 'but', 'if', 'then', 'when', 'where', 'what', 'which', 'who', 'whom', 'whose', 'why', 'how', 'this', 'that', 'these', 'those', 'it', 'its', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'up', 'down', 'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'im', 'i', 'you', 'we', 'they', 'my', 'your', 'our', 'their']);
    return stops.has(word.toLowerCase());
}

/**
 * 사용자 ID 기준으로 DB에서 옵션 조회 후 단어장 생성. 없으면 기본값 사용.
 * env.saveVocabularyList가 있으면 생성된 단어장을 해당 사용자로 DB에 저장한다.
 * @param meta - 저장 시 title (선택)
 */
export async function createVocabularyFromLyricsForUser(
    lyrics: string,
    userId: string,
    env: VocabularyEnvWithDb,
    meta?: { title?: string }
): Promise<VocabularyEntry[]> {
    const getSettings = env.getVocabularySettings ?? (() => Promise.resolve(null));
    const options = await getVocabularyOptionsForUser(userId, getSettings);
    const entries = await createVocabularyFromLyrics(lyrics, options, env);
    if (env.saveVocabularyList) {
        await env.saveVocabularyList({
            userId,
            entries,
            title: meta?.title,
        });
    }
    return entries;
}
