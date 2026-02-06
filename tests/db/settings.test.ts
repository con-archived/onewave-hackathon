/**
 * db/settings.ts 테스트.
 * runQuery를 mock하여 getVocabularySettings, saveVocabularyList, create* 함수 검증.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    getVocabularySettings,
    createGetVocabularySettings,
    saveVocabularyList,
    createSaveVocabularyList,
    type QueryRunner,
    type UserVocabularySettingsRow,
    type SaveVocabularyListPayload,
} from "../../src/db/settings";

describe("db/settings", () => {
    let mockRunQuery: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockRunQuery = vi.fn();
    });

    describe("getVocabularySettings", () => {
        it("should return row when runQuery returns one row", async () => {
            const row: UserVocabularySettingsRow = {
                language: "ko",
                level: "advanced",
                max_words: 50,
                min_length: 3,
            };
            mockRunQuery.mockResolvedValueOnce({ rows: [row] });

            const result = await getVocabularySettings(
                "user-uuid-123",
                mockRunQuery as QueryRunner
            );

            expect(result).toEqual(row);
            expect(mockRunQuery).toHaveBeenCalledTimes(1);
            expect(mockRunQuery.mock.calls[0][0]).toContain("user_vocabulary_settings");
            expect(mockRunQuery.mock.calls[0][0]).toContain("user_id = $1");
            expect(mockRunQuery.mock.calls[0][1]).toEqual(["user-uuid-123"]);
        });

        it("should return null when runQuery returns empty rows", async () => {
            mockRunQuery.mockResolvedValueOnce({ rows: [] });

            const result = await getVocabularySettings(
                "user-uuid-456",
                mockRunQuery as QueryRunner
            );

            expect(result).toBeNull();
        });

        it("should return null when runQuery returns undefined rows", async () => {
            mockRunQuery.mockResolvedValueOnce({ rows: undefined });

            const result = await getVocabularySettings(
                "user-uuid-789",
                mockRunQuery as QueryRunner
            );

            expect(result).toBeNull();
        });
    });

    describe("createGetVocabularySettings", () => {
        it("should return a function that calls getVocabularySettings with runQuery", async () => {
            const row: UserVocabularySettingsRow = {
                language: "en",
                level: "beginner",
                max_words: 20,
                min_length: 2,
            };
            mockRunQuery.mockResolvedValueOnce({ rows: [row] });

            const getSettings = createGetVocabularySettings(mockRunQuery as QueryRunner);
            const result = await getSettings("user-abc");

            expect(result).toEqual(row);
            expect(mockRunQuery).toHaveBeenCalledWith(
                expect.stringContaining("user_vocabulary_settings"),
                ["user-abc"]
            );
        });
    });

    describe("saveVocabularyList", () => {
        it("should call runQuery for vocabulary_lists INSERT and user_words upsert", async () => {
            mockRunQuery.mockResolvedValue({ rows: [] });

            const payload: SaveVocabularyListPayload = {
                userId: "user-1",
                entries: [{ word: "hello", meaning: "안녕" }],
                title: "My List",
            };
            await saveVocabularyList(payload, mockRunQuery as QueryRunner);

            expect(mockRunQuery).toHaveBeenCalledTimes(2);
            expect(mockRunQuery.mock.calls[0][0]).toContain("vocabulary_lists");
            expect(mockRunQuery.mock.calls[0][0]).toContain("INSERT");
            expect(mockRunQuery.mock.calls[0][1]).toEqual([
                "user-1",
                "My List",
                JSON.stringify(payload.entries),
            ]);
            expect(mockRunQuery.mock.calls[1][0]).toContain("user_words");
            expect(mockRunQuery.mock.calls[1][0]).toContain("ON CONFLICT");
            expect(mockRunQuery.mock.calls[1][1]).toEqual(["user-1", "hello", "안녕", 1]);
        });

        it("should pass null for title when title is undefined", async () => {
            mockRunQuery.mockResolvedValue({ rows: [] });

            const payload: SaveVocabularyListPayload = {
                userId: "user-2",
                entries: [],
            };
            await saveVocabularyList(payload, mockRunQuery as QueryRunner);

            expect(mockRunQuery).toHaveBeenCalledTimes(1);
            expect(mockRunQuery.mock.calls[0][1]).toEqual(["user-2", null, "[]"]);
        });

        it("should pass occurrences to user_words upsert when provided in entries", async () => {
            mockRunQuery.mockResolvedValue({ rows: [] });

            const payload: SaveVocabularyListPayload = {
                userId: "user-3",
                entries: [
                    { word: "hello", meaning: "안녕", occurrences: 2 },
                    { word: "world", occurrences: 3 },
                ],
                title: "List",
            };
            await saveVocabularyList(payload, mockRunQuery as QueryRunner);

            expect(mockRunQuery).toHaveBeenCalledTimes(3);
            expect(mockRunQuery.mock.calls[1][1]).toEqual(["user-3", "hello", "안녕", 2]);
            expect(mockRunQuery.mock.calls[2][1]).toEqual(["user-3", "world", null, 3]);
        });

        it("should pass null for title when title is null", async () => {
            mockRunQuery.mockResolvedValue({ rows: [] });

            await saveVocabularyList(
                { userId: "u", entries: [], title: null },
                mockRunQuery as QueryRunner
            );

            expect(mockRunQuery).toHaveBeenCalledTimes(1);
            expect(mockRunQuery.mock.calls[0][1][1]).toBeNull();
        });
    });

    describe("createSaveVocabularyList", () => {
        it("should return a function that calls saveVocabularyList with runQuery", async () => {
            mockRunQuery.mockResolvedValue({ rows: [] });

            const saveList = createSaveVocabularyList(mockRunQuery as QueryRunner);
            await saveList({
                userId: "user-xyz",
                entries: [{ word: "test" }],
                title: "Title",
            });

            expect(mockRunQuery).toHaveBeenCalledTimes(2);
            expect(mockRunQuery.mock.calls[0][1]).toEqual([
                "user-xyz",
                "Title",
                JSON.stringify([{ word: "test" }]),
            ]);
        });
    });
});
