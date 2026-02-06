/**
 * user_music_history 저장/조회 (api-spec POST/GET /music/history).
 */

import type { QueryRunner } from "./settings";

export interface InsertMusicHistoryPayload {
    video_id: string;
    title: string;
    capture_time?: number | null;
    origin?: string | null;
}

export interface MusicHistoryRow {
    id: string;
    video_id: string;
    title: string | null;
    capture_time: number | null;
    origin: string | null;
    created_at: string;
}

const INSERT_HISTORY_SQL = `
  INSERT INTO user_music_history (user_id, video_id, title, capture_time, origin)
  VALUES ($1, $2, $3, $4, $5)
  RETURNING id, created_at
`;

const SELECT_HISTORY_SQL = `
  SELECT id, video_id, title, capture_time, origin, created_at
  FROM user_music_history
  WHERE user_id = $1
  ORDER BY created_at DESC
`;

export async function insertMusicHistory(
    userId: string,
    payload: InsertMusicHistoryPayload,
    runQuery: QueryRunner
): Promise<{ id: string; created_at: string }> {
    const { rows } = await runQuery(INSERT_HISTORY_SQL, [
        userId,
        payload.video_id,
        payload.title,
        payload.capture_time ?? null,
        payload.origin ?? "YouTube",
    ]);
    const row = rows?.[0] as { id: string; created_at: string } | undefined;
    if (!row?.id) throw new Error("Failed to insert music history");
    return row;
}

export async function getMusicHistory(
    userId: string,
    runQuery: QueryRunner
): Promise<MusicHistoryRow[]> {
    const { rows } = await runQuery(SELECT_HISTORY_SQL, [userId]);
    return (rows ?? []) as MusicHistoryRow[];
}
