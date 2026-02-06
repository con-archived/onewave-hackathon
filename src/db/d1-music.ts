/**
 * D1-compatible music history operations
 */

import type { D1Binding } from "./d1";

export interface MusicHistoryRow {
    id: string;
    video_id: string;
    title: string;
    capture_time: number | null;
    origin: string;
    created_at: string;
}

export interface InsertMusicHistoryPayload {
    video_id: string;
    title: string;
    capture_time?: number;
    origin?: string;
}

const INSERT_MUSIC_HISTORY_SQL = `
  INSERT INTO user_music_history (id, user_id, video_id, title, capture_time, origin, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`;

const SELECT_MUSIC_HISTORY_SQL = `
  SELECT id, video_id, title, capture_time, origin, created_at
  FROM user_music_history
  WHERE user_id = ?
  ORDER BY created_at DESC
  LIMIT 100
`;

/** Insert music history */
export async function d1InsertMusicHistory(
    db: D1Binding,
    userId: string,
    payload: InsertMusicHistoryPayload
): Promise<{ id: string; created_at: string }> {
    const { generateUUID, nowISO } = await import("./d1");

    const id = generateUUID();
    const now = nowISO();

    await db
        .prepare(INSERT_MUSIC_HISTORY_SQL)
        .bind(id, userId, payload.video_id, payload.title, payload.capture_time ?? null, payload.origin ?? "YouTube", now)
        .run();

    return { id, created_at: now };
}

/** Get music history */
export async function d1GetMusicHistory(db: D1Binding, userId: string): Promise<MusicHistoryRow[]> {
    const stmt = db.prepare(SELECT_MUSIC_HISTORY_SQL);
    const result = await stmt.bind(userId).all();

    return (result.results ?? []) as MusicHistoryRow[];
}
