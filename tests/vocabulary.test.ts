/**
 * vocabulary 모듈 테스트 (lib/gemini.generateText 스트리밍 사용)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    createVocabularyFromLyrics,
    type VocabularyEnv,
    type VocabularyEntry,
} from "../src/vocabulary";

const MOCK_API_KEY = "test-gemini-api-key";
const mockEnv: VocabularyEnv = { GEMINI_API_KEY: MOCK_API_KEY };

async function* mockStream(text: string): AsyncGenerator<string, void, unknown> {
    yield text;
}

const mockGenerateText = vi.fn();
vi.mock("../src/lib/gemini", () => ({
    generateText: (prompt: string, env: unknown) => mockGenerateText(prompt, env),
}));

describe("vocabulary", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("createVocabularyFromLyrics", () => {
        it("should return vocabulary entries when Gemini returns valid JSON array", async () => {
            const mockVocab: VocabularyEntry[] = [
                { word: "shine", score: 8, meaning: "to give out light", example: "shine bright" },
                { word: "forever", score: 7, meaning: "for all time", example: "last forever" },
            ];
            mockGenerateText.mockReturnValueOnce(mockStream(JSON.stringify(mockVocab)));

            const lyrics = "We shine bright like a diamond. Forever and ever.";
            const result = await createVocabularyFromLyrics(lyrics, { language: "en" }, mockEnv);

            expect(result).toHaveLength(2);
            expect(result[0].word).toBe("shine");
            expect(result[0].score).toBe(8);
            expect(result[1].word).toBe("forever");
            expect(mockGenerateText).toHaveBeenCalledTimes(1);
            expect(mockGenerateText.mock.calls[0][0]).toContain("--- Lyrics ---");
            expect(mockGenerateText.mock.calls[0][0]).toContain(lyrics);
            expect(mockGenerateText.mock.calls[0][1]).toMatchObject({
                SECRET_GEMINI_API_KEY: MOCK_API_KEY,
            });
        });

        it("returns vocabulary from sample lyrics (mock response)", async () => {
            const mockVocab: VocabularyEntry[] = [
                { word: "shine", score: 8, meaning: "빛나다", example: "shine bright" },
                { word: "forever", score: 7, meaning: "영원히", example: "last forever" },
            ];
            mockGenerateText.mockReturnValueOnce(mockStream(JSON.stringify(mockVocab)));

            const result = await createVocabularyFromLyrics(
                "We shine bright like a diamond.",
                { language: "en", maxWords: 10 },
                mockEnv
            );

            expect(result.length).toBeGreaterThan(0);
        });

        it("should include level instruction in prompt for beginner", async () => {
            mockGenerateText.mockReturnValueOnce(
                mockStream(JSON.stringify([{ word: "hello", score: 5 }]))
            );

            await createVocabularyFromLyrics(
                "hello world",
                { language: "en", level: "beginner" },
                mockEnv
            );

            const prompt = mockGenerateText.mock.calls[0][0];
            expect(prompt).toContain("beginner");
            expect(prompt).toContain("high-frequency");
        });

        it("should include level instruction in prompt for advanced", async () => {
            mockGenerateText.mockReturnValueOnce(
                mockStream(JSON.stringify([{ word: "idiom", score: 9 }]))
            );

            await createVocabularyFromLyrics(
                "some lyrics",
                { language: "en", level: "advanced" },
                mockEnv
            );

            const prompt = mockGenerateText.mock.calls[0][0];
            expect(prompt).toContain("advanced");
            expect(prompt).toContain("idioms");
        });

        it("should pass maxWords and minLength in prompt and slice result", async () => {
            const fiveWords: VocabularyEntry[] = [
                { word: "aa", score: 1 },
                { word: "bb", score: 2 },
                { word: "cc", score: 3 },
                { word: "dd", score: 4 },
                { word: "ee", score: 5 },
            ];
            mockGenerateText.mockReturnValueOnce(mockStream(JSON.stringify(fiveWords)));

            const result = await createVocabularyFromLyrics(
                "lyrics",
                { language: "en", maxWords: 3, minLength: 2 },
                mockEnv
            );

            expect(result).toHaveLength(3);
            const prompt = mockGenerateText.mock.calls[0][0];
            expect(prompt).toContain("at most 3 words");
            expect(prompt).toContain("shorter than 2 characters");
        });

        it("should filter out entries with word shorter than minLength", async () => {
            const mixed: VocabularyEntry[] = [
                { word: "a", score: 1 },
                { word: "longword", score: 8 },
            ];
            mockGenerateText.mockReturnValueOnce(mockStream(JSON.stringify(mixed)));

            const result = await createVocabularyFromLyrics(
                "a longword",
                { language: "en", minLength: 2 },
                mockEnv
            );

            expect(result).toHaveLength(1);
            expect(result[0].word).toBe("longword");
        });

        it("should dedupe by word (first occurrence kept, case-insensitive) and set occurrences", async () => {
            const withDupes: VocabularyEntry[] = [
                { word: "shine", score: 8 },
                { word: "Shine", score: 5 },
                { word: "forever", score: 7 },
            ];
            mockGenerateText.mockReturnValueOnce(mockStream(JSON.stringify(withDupes)));

            const result = await createVocabularyFromLyrics(
                "lyrics",
                { language: "en", maxWords: 10, minLength: 2 },
                mockEnv
            );

            expect(result).toHaveLength(2);
            expect(result[0].word).toBe("shine");
            expect(result[0].occurrences).toBe(2);
            expect(result[1].word).toBe("forever");
            expect(result[1].occurrences).toBe(1);
        });

        it("should throw when GEMINI_API_KEY is missing", async () => {
            const envNoKey = { GEMINI_API_KEY: "" } as VocabularyEnv;

            await expect(
                createVocabularyFromLyrics("lyrics", { language: "en" }, envNoKey)
            ).rejects.toThrow("GEMINI_API_KEY is required in env");
            expect(mockGenerateText).not.toHaveBeenCalled();
        });

        it("should throw when Gemini returns invalid JSON", async () => {
            mockGenerateText.mockReturnValueOnce(mockStream("not valid json array"));

            await expect(
                createVocabularyFromLyrics("lyrics", { language: "en" }, mockEnv)
            ).rejects.toThrow("Gemini returned invalid JSON for vocabulary");
        });

        it("should return empty array when Gemini returns non-array JSON", async () => {
            mockGenerateText.mockReturnValueOnce(mockStream("{}"));

            const result = await createVocabularyFromLyrics("lyrics", { language: "en" }, mockEnv);
            expect(result).toEqual([]);
        });

        it("should normalize Korean language in prompt", async () => {
            mockGenerateText.mockReturnValueOnce(
                mockStream(JSON.stringify([{ word: "사랑", score: 8 }]))
            );

            await createVocabularyFromLyrics("사랑해 영원히", { language: "ko" }, mockEnv);

            const prompt = mockGenerateText.mock.calls[0][0];
            expect(prompt).toContain("Korean");
        });
    });
});
