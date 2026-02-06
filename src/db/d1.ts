/**
 * D1-compatible database layer.
 * Replaces Postgres/Hyperdrive with Cloudflare D1.
 */

/** D1 binding type from Cloudflare Workers */
export type D1Binding = {
    prepare: (sql: string) => D1PreparedStatement;
    exec: (sql: string) => Promise<{ meta: { rowsRead?: number; rowsWritten?: number } }>;
    batch: (statements: D1PreparedStatement[]) => Promise<unknown[]>;
};

export type D1PreparedStatement = {
    bind: (...params: unknown[]) => D1PreparedStatement;
    all: (...params: unknown[]) => Promise<{ results: unknown[]; meta?: unknown }>;
    first: (...params: unknown[]) => Promise<unknown>;
    run: (...params: unknown[]) => Promise<{ meta: { rowsRead?: number; rowsWritten?: number } }>;
};

export type D1QueryRunner = (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }>;

/** Convert Postgres $1, $2 to D1 ? placeholders and create query runner */
export function createD1QueryRunner(db: D1Binding): D1QueryRunner {
    return async (sql: string, params: unknown[]) => {
        // Convert $1, $2... to ? (D1 style)
        const d1Sql = sql.replace(/\$(\d+)/g, () => "?");

        // Handle ::jsonb type cast - remove it for D1
        const cleanedSql = d1Sql.replace(/::jsonb/g, "");

        const stmt = db.prepare(cleanedSql);
        const result = await stmt.all(params as string[]);
        return { rows: result.results ?? [] };
    };
}

/** Generate UUID for D1 (no gen_random_uuid()) */
export function generateUUID(): string {
    return crypto.randomUUID();
}

/** Current timestamp for D1 */
export function nowISO(): string {
    return new Date().toISOString();
}

// Re-export types from settings.ts
export type {
    UserVocabularySettingsRow,
    QueryRunner,
    SaveVocabularyListPayload,
    UpsertUserWordEntry,
    VocabularyListItem,
    UserWordWithSynonyms,
} from "./settings";

// Re-export functions that work with the QueryRunner interface
export { getVocabularySettings, createGetVocabularySettings } from "./settings";

/** D1-specific: vocabulary_lists insert */
const INSERT_VOCABULARY_LIST_SQL = `
  INSERT INTO vocabulary_lists (id, user_id, title, entries, created_at)
  VALUES (?, ?, ?, ?, ?)
`;

/** D1: insert user_words (new word only) */
const INSERT_USER_WORD_SQL = `
  INSERT INTO user_words (id, user_id, word, meaning, count, song_title, song_artist, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`;

/** D1: update existing user_words count */
const UPDATE_USER_WORD_COUNT_SQL = `
  UPDATE user_words
  SET count = count + ?,
      meaning = COALESCE(?, meaning),
      song_title = COALESCE(?, song_title),
      song_artist = COALESCE(?, song_artist)
  WHERE user_id = ? AND word = ?
`;

/** D1: select existing user_word id */
const SELECT_USER_WORD_ID_SQL = `
  SELECT id FROM user_words WHERE user_id = ? AND word = ?
`;

/** D1-specific: word_synonyms insert (ignore duplicates) */
const INSERT_WORD_SYNONYM_SQL = `
  INSERT OR IGNORE INTO word_synonyms (user_word_id, synonym)
  VALUES (?, ?)
`;

/** D1: upsert user_words - explicit insert then update for D1 compatibility */
export async function d1UpsertUserWords(
    db: D1Binding,
    userId: string,
    entries: Array<{
        word: string;
        meaning?: string | null;
        occurrences?: number;
        songTitle?: string | null;
        songArtist?: string | null;
    }>
): Promise<Array<{ word: string; id: string }>> {
    const result: Array<{ word: string; id: string }> = [];

    for (const e of entries) {
        const word = String(e.word).trim();
        if (!word) continue;

        const occurrences =
            typeof e.occurrences === "number" && e.occurrences >= 1 ? e.occurrences : 1;

        // First, check if word exists - use .all() instead of .first() for D1 reliability
        const selectStmt = db.prepare(SELECT_USER_WORD_ID_SQL);
        const selectResult = await selectStmt.bind(userId, word).all();
        const existing = (selectResult.results?.[0] as { id: string } | undefined) ?? undefined;

        if (existing?.id) {
            // Update existing word
            const updateStmt = db.prepare(UPDATE_USER_WORD_COUNT_SQL);
            await updateStmt
                .bind(
                    occurrences,
                    e.meaning ?? null,
                    e.songTitle ?? null,
                    e.songArtist ?? null,
                    userId,
                    word
                )
                .run();
            result.push({ word, id: existing.id });
        } else {
            // Insert new word
            const id = generateUUID();
            const createdAt = nowISO();
            const insertStmt = db.prepare(INSERT_USER_WORD_SQL);
            await insertStmt
                .bind(
                    id,
                    userId,
                    word,
                    e.meaning ?? null,
                    occurrences,
                    e.songTitle ?? null,
                    e.songArtist ?? null,
                    createdAt
                )
                .run();
            result.push({ word, id });
        }
    }

    return result;
}

/** D1: insert word synonyms */
export async function d1InsertWordSynonyms(
    db: D1Binding,
    userWordId: string,
    synonyms: string[]
): Promise<void> {
    const list = synonyms.map((s) => String(s).trim()).filter((s) => s.length > 0);
    if (list.length === 0) return;

    // D1 batch requires separate prepared statement instances
    const statements = list.map((s) => db.prepare(INSERT_WORD_SYNONYM_SQL).bind(userWordId, s));

    await db.batch(statements);
}

/** D1: save vocabulary list */
export async function d1SaveVocabularyList(
    db: D1Binding,
    userId: string,
    entries: unknown[],
    title?: string | null
): Promise<void> {
    const id = generateUUID();
    const createdAt = nowISO();
    const entriesJson = JSON.stringify(entries);

    await db
        .prepare(INSERT_VOCABULARY_LIST_SQL)
        .bind(id, userId, title ?? null, entriesJson, createdAt)
        .run();

    // Also upsert user_words
    const userWordEntries: Array<{
        word: string;
        meaning?: string | null;
        occurrences?: number;
        songTitle?: string | null;
        songArtist?: string | null;
    }> = (Array.isArray(entries) ? entries : [])
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
            songTitle: (e as { songTitle?: string }).songTitle,
            songArtist: (e as { songArtist?: string }).songArtist,
        }));

    const wordIds = await d1UpsertUserWords(db, userId, userWordEntries);

    const idByWord = new Map(wordIds.map(({ word, id }) => [word, id]));

    // Insert synonyms
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

        await d1InsertWordSynonyms(db, userWordId, synonyms);
    }
}

/** D1: get vocabulary lists */
const SELECT_VOCABULARY_LISTS_SQL = `
  SELECT id, title, entries, created_at
  FROM vocabulary_lists
  WHERE user_id = ?
  ORDER BY created_at DESC
`;

export async function d1GetVocabularyLists(
    db: D1Binding,
    userId: string
): Promise<Array<{ id: string; title: string | null; entries: unknown; created_at: string }>> {
    const stmt = db.prepare(SELECT_VOCABULARY_LISTS_SQL);
    const result = await stmt.bind(userId).all();

    return (result.results ?? []).map((row: unknown) => {
        const r = row as { id: string; title: string | null; entries: string; created_at: string };
        return {
            id: r.id,
            title: r.title,
            entries: JSON.parse(r.entries ?? "[]"),
            created_at: r.created_at,
        };
    });
}

/** D1: get user words with synonyms */
const SELECT_USER_WORDS_SQL = `
  SELECT uw.id, uw.word, uw.meaning, uw.count, uw.song_title, uw.song_artist, uw.created_at
  FROM user_words uw
  WHERE uw.user_id = ?
  ORDER BY uw.created_at DESC
`;

const SELECT_SYNONYMS_SQL = `
  SELECT synonym
  FROM word_synonyms
  WHERE user_word_id = ?
`;

export async function d1GetUserWordsWithSynonyms(
    db: D1Binding,
    userId: string
): Promise<
    Array<{
        id: string;
        word: string;
        meaning: string | null;
        count: number;
        song_title: string;
        song_artist: string;
        synonyms: string[];
    }>
> {
    const stmt = db.prepare(SELECT_USER_WORDS_SQL);
    const result = await stmt.bind(userId).all();

    const words = (result.results ?? []) as Array<{
        id: string;
        word: string;
        meaning: string | null;
        count: number;
        song_title: string;
        song_artist: string;
        created_at: string;
    }>;

    const output: Array<{
        id: string;
        word: string;
        meaning: string | null;
        count: number;
        song_title: string;
        song_artist: string;
        synonyms: string[];
    }> = [];

    for (const w of words) {
        const synStmt = db.prepare(SELECT_SYNONYMS_SQL);
        const synResult = await synStmt.bind(w.id).all();
        const synonyms = (synResult.results ?? []).map(
            (r: unknown) => (r as { synonym: string }).synonym
        );

        output.push({
            id: w.id,
            word: w.word,
            meaning: w.meaning,
            count: w.count,
            song_title: w.song_title,
            song_artist: w.song_artist,
            synonyms: synonyms as string[],
        });
    }

    return output;
}
