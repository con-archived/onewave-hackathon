/**
 * D1-compatible users operations
 */

import type { D1Binding } from "./d1";

export interface SyncUserResult {
    internal_id: string;
    is_new_user: boolean;
}

export interface UserProfileData {
    id: string;
    display_name: string | null;
    email: string | null;
    settings: {
        language: string;
        level: string;
        max_words: number;
        min_length: number;
    } | null;
}

export interface UpdateSettingsPayload {
    language?: string;
    level?: string;
    max_words?: number;
    min_length?: number;
}

const SELECT_USER_BY_PROVIDER_SQL = `
  SELECT id FROM users
  WHERE provider = ? AND provider_user_id = ?
  LIMIT 1
`;

const INSERT_USER_SQL = `
  INSERT INTO users (id, provider, provider_user_id, email, display_name, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
`;

const INSERT_SETTINGS_SQL = `
  INSERT INTO user_vocabulary_settings (user_id, language, level, max_words, min_length)
  VALUES (?, 'en', 'intermediate', 30, 2)
`;

const SELECT_USER_PROFILE_SQL = `
  SELECT u.id, u.email, u.display_name,
         s.language, s.level, s.max_words, s.min_length
  FROM users u
  LEFT JOIN user_vocabulary_settings s ON s.user_id = u.id
  WHERE u.id = ?
  LIMIT 1
`;

const UPDATE_SETTINGS_SQL = `
  INSERT INTO user_vocabulary_settings (user_id, language, level, max_words, min_length)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT (user_id) DO UPDATE SET
    language = excluded.language,
    level = excluded.level,
    max_words = excluded.max_words,
    min_length = excluded.min_length
`;

/** Sync user from OAuth */
export async function d1SyncUserFromOAuth(
    db: D1Binding,
    provider: string,
    providerUserId: string,
    email: string | null,
    displayName: string | null
): Promise<SyncUserResult> {
    const { generateUUID, nowISO } = await import("./d1");

    // Check existing user
    const selectStmt = db.prepare(SELECT_USER_BY_PROVIDER_SQL);
    const existing = await selectStmt.bind(provider, providerUserId).first() as { id: string } | undefined;

    if (existing) {
        return { internal_id: existing.id, is_new_user: false };
    }

    // Create new user
    const userId = generateUUID();
    const now = nowISO();

    await db.batch([
        db.prepare(INSERT_USER_SQL).bind(userId, provider, providerUserId, email, displayName, now),
        db.prepare(INSERT_SETTINGS_SQL).bind(userId),
    ]);

    return { internal_id: userId, is_new_user: true };
}

/** Get user profile */
export async function d1GetUserProfile(
    db: D1Binding,
    userId: string
): Promise<UserProfileData | null> {
    const stmt = db.prepare(SELECT_USER_PROFILE_SQL);
    const row = await stmt.bind(userId).first() as {
        id: string;
        email: string | null;
        display_name: string | null;
        language: string | null;
        level: string | null;
        max_words: number | null;
        min_length: number | null;
    } | undefined;

    if (!row) return null;

    const settings =
        row.language != null
            ? {
                  language: row.language,
                  level: row.level ?? "intermediate",
                  max_words: row.max_words ?? 30,
                  min_length: row.min_length ?? 2,
              }
            : null;

    return {
        id: row.id,
        email: row.email,
        display_name: row.display_name,
        settings,
    };
}

/** Update user settings */
export async function d1UpdateUserVocabularySettings(
    db: D1Binding,
    userId: string,
    payload: UpdateSettingsPayload
): Promise<{ language: string; level: string; max_words: number; min_length: number }> {
    const stmt = db.prepare(UPDATE_SETTINGS_SQL);
    await stmt
        .bind(
            userId,
            payload.language ?? "en",
            payload.level ?? "intermediate",
            payload.max_words ?? 30,
            payload.min_length ?? 2
        )
        .run();

    return {
        language: payload.language ?? "en",
        level: payload.level ?? "intermediate",
        max_words: payload.max_words ?? 30,
        min_length: payload.min_length ?? 2,
    };
}
