/**
 * user_vocabulary_settings 조회 및 vocabulary_lists 저장 (db.md 기준).
 * Hyperdrive 등으로 실제 SQL을 실행하는 쪽에서 runQuery를 구현해 주입.
 */

/** DB row: user_vocabulary_settings 테이블 한 행 */
export interface UserVocabularySettingsRow {
    language: string;
    level: string;
    max_words: number;
    min_length: number;
}

/** 파라미터화된 쿼리 실행 시그니처. Hyperdrive + Postgres 클라이언트로 구현 후 주입 */
export type QueryRunner = (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }>;

/** @deprecated use QueryRunner */
export type RunQuery = QueryRunner;

/** vocabulary_lists insert 시 사용할 payload (VocabularyEntry[]는 호출 측에서 직렬화) */
export interface SaveVocabularyListPayload {
    userId: string;
    entries: unknown[];
    title?: string | null;
}

/** user_words upsert 시 한 항목 (word 필수, meaning·occurrences 선택) */
export interface UpsertUserWordEntry {
    word: string;
    meaning?: string | null;
    /** 이번 저장에서 더할 횟수. 없으면 1 (user_words.count += occurrences) */
    occurrences?: number;
}

const SELECT_SETTINGS_SQL = `
  SELECT language, level, max_words, min_length
  FROM user_vocabulary_settings
  WHERE user_id = $1
  LIMIT 1
`;

/**
 * user_id로 user_vocabulary_settings 한 행 조회.
 * 없으면 null. runQuery는 앱에서 Hyperdrive 등으로 구현해 전달.
 */
export async function getVocabularySettings(
    userId: string,
    runQuery: QueryRunner
): Promise<UserVocabularySettingsRow | null> {
    const { rows } = await runQuery(SELECT_SETTINGS_SQL, [userId]);
    const list = rows ?? [];
    return (list[0] ?? null) as UserVocabularySettingsRow | null;
}

/**
 * runQuery를 받아 (userId) => getVocabularySettings(userId, runQuery) 를 반환.
 * vocabulary.ts의 createVocabularyFromLyricsForUser에 넘길 getSettings 함수 생성용.
 */
export function createGetVocabularySettings(
    runQuery: QueryRunner
): (userId: string) => Promise<UserVocabularySettingsRow | null> {
    return (userId: string) => getVocabularySettings(userId, runQuery);
}

const INSERT_VOCABULARY_LIST_SQL = `
  INSERT INTO vocabulary_lists (user_id, title, entries)
  VALUES ($1, $2, $3::jsonb)
`;

const UPSERT_USER_WORD_SQL = `
  INSERT INTO user_words (user_id, word, meaning, count)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (user_id, word)
  DO UPDATE SET count = user_words.count + EXCLUDED.count, meaning = COALESCE(EXCLUDED.meaning, user_words.meaning)
  RETURNING id
`;

const INSERT_WORD_SYNONYM_SQL = `
  INSERT INTO word_synonyms (user_word_id, synonym)
  SELECT $1, unnest($2::text[])
  ON CONFLICT (user_word_id, synonym) DO NOTHING
`;

/**
 * user_words에 단어 upsert. (user_id, word)가 있으면 count += occurrences, 없으면 insert (count=occurrences).
 * 반환: 단어별 user_words.id (유의어 저장 시 사용).
 */
export async function upsertUserWords(
    userId: string,
    entries: UpsertUserWordEntry[],
    runQuery: QueryRunner
): Promise<{ word: string; id: string }[]> {
    const result: { word: string; id: string }[] = [];
    for (const e of entries) {
        const word = String(e.word).trim();
        if (!word) continue;
        const occurrences =
            typeof e.occurrences === "number" && e.occurrences >= 1 ? e.occurrences : 1;
        const { rows } = await runQuery(UPSERT_USER_WORD_SQL, [
            userId,
            word,
            e.meaning ?? null,
            occurrences,
        ]);
        const row = (rows ?? [])[0] as { id: string } | undefined;
        if (row?.id) result.push({ word, id: row.id });
    }
    return result;
}

/**
 * 한 user_word에 대한 유의어 일괄 삽입. (user_word_id, synonym) 중복은 무시.
 */
export async function insertWordSynonyms(
    userWordId: string,
    synonyms: string[],
    runQuery: QueryRunner
): Promise<void> {
    const list = synonyms.map((s) => String(s).trim()).filter((s) => s.length > 0);
    if (list.length === 0) return;
    await runQuery(INSERT_WORD_SYNONYM_SQL, [userWordId, list]);
}

/**
 * vocabulary_lists에 한 행 insert 후, 각 단어를 user_words에 upsert (중복 시 count 증가).
 */
export async function saveVocabularyList(
    payload: SaveVocabularyListPayload,
    runQuery: QueryRunner
): Promise<void> {
    await runQuery(INSERT_VOCABULARY_LIST_SQL, [
        payload.userId,
        payload.title ?? null,
        JSON.stringify(payload.entries),
    ]);
    const entries = Array.isArray(payload.entries) ? payload.entries : [];
    const userWordEntries: UpsertUserWordEntry[] = entries
        .filter(
            (e): e is Record<string, unknown> =>
                e != null &&
                typeof e === "object" &&
                typeof (e as { word?: unknown }).word === "string"
        )
        .map((e) => ({
            word: String((e as { word: string }).word).trim(),
            meaning: (e as { meaning?: string }).meaning,
            occurrences: (e as { occurrences?: number }).occurrences,
        }));
    const wordIds = await upsertUserWords(payload.userId, userWordEntries, runQuery);
    const idByWord = new Map(wordIds.map(({ word, id }) => [word, id]));
    for (const e of entries) {
        if (
            e == null ||
            typeof e !== "object" ||
            typeof (e as { word?: unknown }).word !== "string"
        )
            continue;
        const word = String((e as { word: string }).word).trim();
        const synonyms = (e as { synonyms?: string[] }).synonyms;
        if (!Array.isArray(synonyms) || synonyms.length === 0) continue;
        const userWordId = idByWord.get(word);
        if (!userWordId) continue;
        await insertWordSynonyms(userWordId, synonyms, runQuery);
    }
}

/**
 * runQuery를 받아 (payload) => saveVocabularyList(payload, runQuery) 를 반환.
 * env.saveVocabularyList 주입용.
 */
export function createSaveVocabularyList(
    runQuery: QueryRunner
): (payload: SaveVocabularyListPayload) => Promise<void> {
    return (payload: SaveVocabularyListPayload) => saveVocabularyList(payload, runQuery);
}

/** GET /vocabulary/lists 한 항목 */
export interface VocabularyListItem {
    id: string;
    title: string | null;
    entries: unknown;
    created_at: string;
}

const SELECT_VOCABULARY_LISTS_SQL = `
  SELECT id, title, entries, created_at
  FROM vocabulary_lists
  WHERE user_id = $1
  ORDER BY created_at DESC
`;

export async function getVocabularyLists(
    userId: string,
    runQuery: QueryRunner
): Promise<VocabularyListItem[]> {
    const { rows } = await runQuery(SELECT_VOCABULARY_LISTS_SQL, [userId]);
    return (rows ?? []) as VocabularyListItem[];
}

/** GET /user/words 한 항목 (user_words + synonyms) */
export interface UserWordWithSynonyms {
    id: string;
    word: string;
    meaning: string | null;
    count: number;
    synonyms: string[];
}

const SELECT_USER_WORDS_WITH_SYNONYMS_SQL = `
  SELECT uw.id, uw.word, uw.meaning, uw.count,
         COALESCE(
           (SELECT array_agg(ws.synonym ORDER BY ws.id) FROM word_synonyms ws WHERE ws.user_word_id = uw.id),
           '{}'
         ) AS synonyms
  FROM user_words uw
  WHERE uw.user_id = $1
  ORDER BY uw.created_at DESC
`;

export async function getUserWordsWithSynonyms(
    userId: string,
    runQuery: QueryRunner
): Promise<UserWordWithSynonyms[]> {
    const { rows } = await runQuery(SELECT_USER_WORDS_WITH_SYNONYMS_SQL, [userId]);
    const list = (rows ?? []) as Array<{
        id: string;
        word: string;
        meaning: string | null;
        count: number;
        synonyms: string[];
    }>;
    return list.map((r) => ({
        id: r.id,
        word: r.word,
        meaning: r.meaning,
        count: Number(r.count),
        synonyms: Array.isArray(r.synonyms) ? r.synonyms : [],
    }));
}
