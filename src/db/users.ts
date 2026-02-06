/**
 * users, user_vocabulary_settings 조회/갱신 (api-spec Auth Sync, profile, settings).
 */

import type { QueryRunner } from "./settings";

const SELECT_USER_BY_PROVIDER_SQL = `
  SELECT id FROM users
  WHERE provider = $1 AND provider_user_id = $2
  LIMIT 1
`;

/** Auth Sync 결과 */
export interface SyncUserResult {
    internal_id: string;
    is_new_user: boolean;
}

/** users 조회 시 반환 행 */
export interface UserRow {
    id: string;
    display_name: string | null;
    email: string | null;
}

/** 프로필 응답용 설정 */
export interface ProfileSettings {
    language: string;
    level: string;
    max_words: number;
    min_length: number;
}

/** GET /user/profile 응답 데이터 */
export interface UserProfileData {
    id: string;
    display_name: string | null;
    email: string | null;
    settings: ProfileSettings | null;
}

/** PATCH /user/settings body (선택 필드) */
export interface UpdateSettingsPayload {
    language?: string;
    level?: string;
    max_words?: number;
    min_length?: number;
}

const INSERT_USER_SQL = `
  INSERT INTO users (provider, provider_user_id, email, display_name)
  VALUES ($1, $2, $3, $4)
  RETURNING id
`;

const INSERT_DEFAULT_SETTINGS_SQL = `
  INSERT INTO user_vocabulary_settings (user_id, language, level, max_words, min_length)
  VALUES ($1, 'en', 'intermediate', 30, 2)
  ON CONFLICT (user_id) DO NOTHING
`;

/**
 * OAuth 로그인 후 유저 동기화. 기존 유저면 id만 반환, 없으면 users insert 후 user_vocabulary_settings 기본값 생성.
 */
export async function syncUserFromOAuth(
    provider: string,
    providerUserId: string,
    runQuery: QueryRunner,
    options?: { email?: string | null; display_name?: string | null }
): Promise<SyncUserResult> {
    const { rows } = await runQuery(SELECT_USER_BY_PROVIDER_SQL, [provider, providerUserId]);
    const existing = rows?.[0] as { id: string } | undefined;

    if (existing) {
        return { internal_id: existing.id, is_new_user: false };
    }

    const insertResult = await runQuery(INSERT_USER_SQL, [
        provider,
        providerUserId,
        options?.email ?? null,
        options?.display_name ?? null,
    ]);
    const row = insertResult.rows?.[0] as { id: string } | undefined;
    if (!row?.id) throw new Error("Failed to insert user");

    await runQuery(INSERT_DEFAULT_SETTINGS_SQL, [row.id]);
    return { internal_id: row.id, is_new_user: true };
}

const SELECT_PROFILE_SQL = `
  SELECT u.id, u.display_name, u.email,
         s.language, s.level, s.max_words, s.min_length
  FROM users u
  LEFT JOIN user_vocabulary_settings s ON s.user_id = u.id
  WHERE u.id = $1
  LIMIT 1
`;

/**
 * GET /user/profile: users 1행 + user_vocabulary_settings (없으면 null).
 */
export async function getUserProfile(
    userId: string,
    runQuery: QueryRunner
): Promise<UserProfileData | null> {
    const { rows } = await runQuery(SELECT_PROFILE_SQL, [userId]);
    const row = rows?.[0] as
        | {
              id: string;
              display_name: string | null;
              email: string | null;
              language: string | null;
              level: string | null;
              max_words: number | null;
              min_length: number | null;
          }
        | undefined;
    if (!row?.id) return null;

    const settings: ProfileSettings | null =
        row.language != null && row.level != null && row.max_words != null && row.min_length != null
            ? {
                  language: row.language,
                  level: row.level,
                  max_words: Number(row.max_words),
                  min_length: Number(row.min_length),
              }
            : null;

    return {
        id: row.id,
        display_name: row.display_name,
        email: row.email,
        settings,
    };
}

/**
 * provider + provider_user_id로 내부 user id 조회 (미들웨어/라우트용).
 */
export async function getInternalUserIdByProvider(
    provider: string,
    providerUserId: string,
    runQuery: QueryRunner
): Promise<string | null> {
    const { rows } = await runQuery(SELECT_USER_BY_PROVIDER_SQL, [provider, providerUserId]);
    const row = rows?.[0] as { id: string } | undefined;
    return row?.id ?? null;
}

const UPSERT_SETTINGS_SQL = `
  INSERT INTO user_vocabulary_settings (user_id, language, level, max_words, min_length)
  VALUES ($1, COALESCE($2, 'en'), COALESCE($3, 'intermediate'), COALESCE($4, 30), COALESCE($5, 2))
  ON CONFLICT (user_id)
  DO UPDATE SET
    language = COALESCE(EXCLUDED.language, user_vocabulary_settings.language),
    level = COALESCE(EXCLUDED.level, user_vocabulary_settings.level),
    max_words = COALESCE(EXCLUDED.max_words, user_vocabulary_settings.max_words),
    min_length = COALESCE(EXCLUDED.min_length, user_vocabulary_settings.min_length)
`;

const SELECT_SETTINGS_AFTER_SQL = `
  SELECT language, level, max_words, min_length
  FROM user_vocabulary_settings WHERE user_id = $1 LIMIT 1
`;

/**
 * PATCH /user/settings: user_vocabulary_settings 업데이트(또는 insert).
 * payload에 있는 필드만 반영. language/level은 유효값만 허장 권장.
 */
export async function updateUserVocabularySettings(
    userId: string,
    payload: UpdateSettingsPayload,
    runQuery: QueryRunner
): Promise<ProfileSettings> {
    await runQuery(UPSERT_SETTINGS_SQL, [
        userId,
        payload.language ?? null,
        payload.level ?? null,
        payload.max_words ?? null,
        payload.min_length ?? null,
    ]);
    const { rows } = await runQuery(SELECT_SETTINGS_AFTER_SQL, [userId]);
    const row = rows?.[0] as ProfileSettings;
    if (!row) throw new Error("Failed to read settings after update");
    return row;
}
