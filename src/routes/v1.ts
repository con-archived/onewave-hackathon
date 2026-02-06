/**
 * API v1 라우트 (api-spec 기반). OAuth2 + JWT 인증, /user/*, /music/history, /vocabulary/*
 * D1 (Cloudflare SQLite) 사용
 */

import { Hono, type Context, type Next } from "hono";
import type { UpdateSettingsPayload } from "../db/users";
import { createVocabularyFromLyricsForUser } from "../vocabulary";
import { searchSongs, getLyricsById } from "../lib/genius";
import { getUserIdFromRequest, type AuthEnv } from "../lib/auth";
import { signJwt } from "../lib/jwt";
import { getGoogleAuthorizeUrl, exchangeCodeAndGetUserInfo } from "../lib/oauth";
import { jsonSuccess, jsonError } from "./responses";
import type { D1Binding } from "../db/d1";
import {
    d1SyncUserFromOAuth,
    d1GetUserProfile,
    d1UpdateUserVocabularySettings,
} from "../db/d1-users";
import { d1InsertMusicHistory, d1GetMusicHistory } from "../db/d1-music";
import { d1GetVocabularyLists, d1GetUserWordsWithSynonyms, d1SaveVocabularyList } from "../db/d1";

/** Cloudflare Workers Bindings (wrangler.jsonc에서 정의된 것들) */
export interface CloudflareBindings {
    // D1 Database
    DB: D1Binding;
    // Environment Variables - OAuth
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    OAUTH_REDIRECT_URI: string;
    FRONTEND_REDIRECT_URI: string;
    JWT_SECRET: string;
    // API Keys
    SECRET_GEMINI_API_KEY: string; // Gemini AI for vocabulary generation
    SECRET_GENIUS_API_KEY: string; // Genius lyrics API
}

/** Hono Variables (request-scoped) */
export type V1Variables = {
    userId?: string;
};

const app = new Hono<{ Variables: V1Variables; Bindings: CloudflareBindings }>();

/** Cloudflare Workers: env vars는 c.env에서 직접 접근 */
function _getBindings(c: Context): CloudflareBindings {
    return c.env as CloudflareBindings;
}

/** Node 로컬 개발용: c.set()으로 주입된 env 사용 (Worker에서는 undefined) */
function _getLocalEnv(c: Context): AuthEnv | undefined {
    return c.get("env") as AuthEnv | undefined;
}

/** D1 가져오기 - Worker에서는 c.env.DB, 로컬에서는 c.get("DB") */
function getDB(c: Context): D1Binding | undefined {
    const bindings = c.env as Partial<CloudflareBindings>;
    if (bindings.DB) return bindings.DB;
    return c.get("DB") as D1Binding | undefined;
}

/** AuthEnv 가져오기 - 우선 순위: c.env > c.get("env") */
function getAuthEnv(c: Context): AuthEnv | undefined {
    const bindings = c.env as Partial<CloudflareBindings>;
    if (bindings.JWT_SECRET) {
        return {
            JWT_SECRET: bindings.JWT_SECRET,
            GOOGLE_CLIENT_ID: bindings.GOOGLE_CLIENT_ID ?? "",
            GOOGLE_CLIENT_SECRET: bindings.GOOGLE_CLIENT_SECRET ?? "",
            OAUTH_REDIRECT_URI: bindings.OAUTH_REDIRECT_URI ?? "",
            FRONTEND_REDIRECT_URI: bindings.FRONTEND_REDIRECT_URI,
        };
    }
    return c.get("env") as AuthEnv | undefined;
}

/** 인증 필요: Bearer JWT 검증 후 userId 설정 */
async function authEndpoint(c: Context, next: Next) {
    const env = getAuthEnv(c);
    if (!env?.JWT_SECRET) {
        return jsonError(c, "SERVICE_UNAVAILABLE", "Auth not configured (JWT_SECRET)", 503);
    }
    const userId = await getUserIdFromRequest(c, env);
    if (!userId) {
        return jsonError(c, "UNAUTHORIZED", "Missing or invalid Authorization", 401);
    }
    c.set("userId", userId);
    return next();
}

/** GET /hello */
app.get("/hello", (c) => c.json({ message: "Hello Hono!" }, 200));

/** POST /echo */
app.post("/echo", async (c) => {
    const body = await c.req.json().catch(() => null);
    return c.json({ echo: body }, 200);
});

/** GET /db/health */
app.get("/db/health", async (c) => {
    const db = getDB(c);
    if (!db) {
        return c.json({ ok: false, error: "DB not configured (D1 binding missing)" }, 503);
    }
    try {
        await db.prepare("SELECT 1 as ok").first();
        return c.json({ ok: true }, 200);
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return c.json({ ok: false, error: message }, 503);
    }
});

// Protected routes (require authentication)
const protectedApp = new Hono<{ Variables: V1Variables; Bindings: CloudflareBindings }>();
protectedApp.use("*", authEndpoint);

/** GET /auth/google: Google 로그인 페이지로 리다이렉트 */
app.get("/auth/google", (c) => {
    const env = getAuthEnv(c);
    if (!env?.GOOGLE_CLIENT_ID || !env?.GOOGLE_CLIENT_SECRET || !env?.OAUTH_REDIRECT_URI) {
        return jsonError(c, "SERVICE_UNAVAILABLE", "OAuth not configured", 503);
    }
    const state = crypto.randomUUID();
    const url = getGoogleAuthorizeUrl(
        {
            GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
            GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
            OAUTH_REDIRECT_URI: env.OAUTH_REDIRECT_URI,
        },
        state
    );
    c.header("Access-Control-Allow-Origin", "*");
    return c.redirect(url);
});

/** GET /auth/google/callback: code 교환 → 유저 동기화 → JWT 발급 후 JSON 반환 */
app.get("/auth/google/callback", async (c) => {
    const db = getDB(c);
    const env = getAuthEnv(c);
    if (!db) return jsonError(c, "SERVICE_UNAVAILABLE", "Database not configured", 503);
    if (
        !env?.JWT_SECRET ||
        !env?.GOOGLE_CLIENT_ID ||
        !env?.GOOGLE_CLIENT_SECRET ||
        !env?.OAUTH_REDIRECT_URI
    ) {
        return jsonError(c, "SERVICE_UNAVAILABLE", "OAuth or JWT not configured", 503);
    }
    const code = c.req.query("code");
    if (!code?.trim()) {
        return jsonError(c, "BAD_REQUEST", "Missing code", 400);
    }
    try {
        const userinfo = await exchangeCodeAndGetUserInfo(code, {
            GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
            GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
            OAUTH_REDIRECT_URI: env.OAUTH_REDIRECT_URI,
        });
        const result = await d1SyncUserFromOAuth(
            db,
            "google",
            userinfo.id,
            userinfo.email ?? null,
            userinfo.name ?? null
        );
        const token = await signJwt(result.internal_id, { JWT_SECRET: env.JWT_SECRET });
        const frontendRedirect = env.FRONTEND_REDIRECT_URI?.trim();
        if (frontendRedirect) {
            const hash = `#token=${encodeURIComponent(token)}&internal_id=${encodeURIComponent(result.internal_id)}&is_new_user=${result.is_new_user}`;
            c.header("Access-Control-Allow-Origin", "*");
            return c.redirect(frontendRedirect + hash, 302);
        }
        return jsonSuccess(c, {
            token,
            internal_id: result.internal_id,
            is_new_user: result.is_new_user,
        });
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return jsonError(c, "AUTH_FAILED", message, 401);
    }
});

function requireUserId(c: { get: (key: keyof V1Variables) => unknown }): string | null {
    const userId = c.get("userId");
    return typeof userId === "string" ? userId : null;
}

/** GET /user/profile */
protectedApp.get("/user/profile", async (c) => {
    const db = getDB(c);
    if (!db) return jsonError(c, "SERVICE_UNAVAILABLE", "Database not configured", 503);
    const userId = requireUserId(c);
    if (!userId) return jsonError(c, "UNAUTHORIZED", "User not found", 401);

    const profile = await d1GetUserProfile(db, userId);
    if (!profile) return jsonError(c, "NOT_FOUND", "Profile not found", 404);
    return jsonSuccess(c, profile);
});

/** PATCH /user/settings */
protectedApp.patch("/user/settings", async (c) => {
    const db = getDB(c);
    if (!db) return jsonError(c, "SERVICE_UNAVAILABLE", "Database not configured", 503);
    const userId = requireUserId(c);
    if (!userId) return jsonError(c, "UNAUTHORIZED", "User not found", 401);

    let body: UpdateSettingsPayload;
    try {
        body = (await c.req.json()) as UpdateSettingsPayload;
    } catch {
        return jsonError(c, "BAD_REQUEST", "Invalid JSON body", 400);
    }
    try {
        const data = await d1UpdateUserVocabularySettings(db, userId, body);
        return jsonSuccess(c, data);
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return jsonError(c, "UPDATE_FAILED", message, 500);
    }
});

/** GET /user/words */
protectedApp.get("/user/words", async (c) => {
    const db = getDB(c);
    if (!db) return jsonError(c, "SERVICE_UNAVAILABLE", "Database not configured", 503);
    const userId = requireUserId(c);
    if (!userId) return jsonError(c, "UNAUTHORIZED", "User not found", 401);

    const list = await d1GetUserWordsWithSynonyms(db, userId);
    return jsonSuccess(c, list);
});

/** POST /music/history */
protectedApp.post("/music/history", async (c) => {
    const db = getDB(c);
    if (!db) return jsonError(c, "SERVICE_UNAVAILABLE", "Database not configured", 503);
    const userId = requireUserId(c);
    if (!userId) return jsonError(c, "UNAUTHORIZED", "User not found", 401);

    let body: { video_id?: string; title?: string; capture_time?: number; origin?: string };
    try {
        body = (await c.req.json()) as typeof body;
    } catch {
        return jsonError(c, "BAD_REQUEST", "Invalid JSON body", 400);
    }
    if (typeof body.video_id !== "string" || !body.video_id.trim()) {
        return jsonError(c, "BAD_REQUEST", "video_id is required", 400);
    }
    if (typeof body.title !== "string") {
        return jsonError(c, "BAD_REQUEST", "title is required", 400);
    }
    try {
        const row = await d1InsertMusicHistory(db, userId, {
            video_id: body.video_id.trim(),
            title: body.title,
            capture_time: body.capture_time,
            origin: body.origin,
        });
        return jsonSuccess(c, { id: row.id, created_at: row.created_at }, 201);
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return jsonError(c, "INSERT_FAILED", message, 500);
    }
});

/** GET /music/history */
protectedApp.get("/music/history", async (c) => {
    const db = getDB(c);
    if (!db) return jsonError(c, "SERVICE_UNAVAILABLE", "Database not configured", 503);
    const userId = requireUserId(c);
    if (!userId) return jsonError(c, "UNAUTHORIZED", "User not found", 401);

    const list = await d1GetMusicHistory(db, userId);
    return jsonSuccess(c, list);
});

/** GET /vocabulary/lists */
protectedApp.get("/vocabulary/lists", async (c) => {
    const db = getDB(c);
    if (!db) return jsonError(c, "SERVICE_UNAVAILABLE", "Database not configured", 503);
    const userId = requireUserId(c);
    if (!userId) return jsonError(c, "UNAUTHORIZED", "User not found", 401);

    const list = await d1GetVocabularyLists(db, userId);
    return jsonSuccess(c, list);
});

/** POST /vocabulary/generate: 노래 제목 → Genius 가사 조회 → Gemini 단어 추출. 저장 형식 동일. */
protectedApp.post("/vocabulary/generate", async (c) => {
    const db = getDB(c);
    if (!db) return jsonError(c, "SERVICE_UNAVAILABLE", "Database not configured", 503);
    const userId = requireUserId(c);
    if (!userId) return jsonError(c, "UNAUTHORIZED", "User not found", 401);

    // Cloudflare Workers Bindings - 직접 접근
    const b = c.env as CloudflareBindings;

    // API Keys
    const geminiKey = b.SECRET_GEMINI_API_KEY;
    const geniusKey = b.SECRET_GENIUS_API_KEY;

    let body: { song_title?: string; title?: string; save?: boolean };
    try {
        body = (await c.req.json()) as typeof body;
    } catch {
        return jsonError(c, "BAD_REQUEST", "Invalid JSON body", 400);
    }
    if (typeof body.song_title !== "string" || !body.song_title.trim()) {
        return jsonError(c, "BAD_REQUEST", "song_title is required", 400);
    }

    const geniusEnv = { SECRET_GENIUS_API_KEY: geniusKey };
    let lyrics: string;
    let songTitle: string;
    let songArtist: string;

    try {
        const hits = await searchSongs(body.song_title.trim(), geniusEnv);
        if (hits.length === 0) {
            return jsonError(c, "NOT_FOUND", "No song found for the given title", 404);
        }
        const song = await getLyricsById(hits[0].id, geniusEnv);
        lyrics = song.lyrics;
        songTitle = song.title;
        songArtist = song.artist;
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return jsonError(c, "LYRICS_FETCH_FAILED", message, 502);
    }

    const save = true;
    const env = {
        GEMINI_API_KEY: geminiKey,
        getVocabularySettings: async (uid: string) => {
            // D1: get vocabulary settings
            const stmt = db.prepare(
                "SELECT language, level, max_words, min_length FROM user_vocabulary_settings WHERE user_id = ?"
            );
            const result = await stmt.bind(uid).first();
            return result as {
                language: string;
                level: string;
                max_words: number;
                min_length: number;
            } | null;
        },
        saveVocabularyList: save
            ? async (payload: { userId: string; entries: unknown[]; title?: string | null }) => {
                  // 각 엔트리에 곡 정보 추가하여 저장
                  const entriesWithSong = (payload.entries as Record<string, unknown>[]).map(
                      (e) => ({
                          ...e,
                          songTitle,
                          songArtist,
                      })
                  );
                  await d1SaveVocabularyList(db, payload.userId, entriesWithSong, payload.title);
              }
            : undefined,
    };
    try {
        const listTitle = body.title?.trim() || `${songTitle} - ${songArtist}`;
        const entries = await createVocabularyFromLyricsForUser(lyrics, userId, env, {
            title: listTitle,
        });

        // 음악 히스토리 자동 저장
        try {
            await d1InsertMusicHistory(db, userId, {
                video_id: body.song_title.trim(), // song_title을 video_id 대용으로 사용
                title: `${songTitle} - ${songArtist}`,
                origin: "Genius",
            });
        } catch {
            // silently ignore history save failure
        }

        // 각 단어 엔트리에 곡 정보 추가
        const entriesWithSong = entries.map((entry) => ({
            ...entry,
            songTitle,
            songArtist,
        }));

        return jsonSuccess(c, {
            entries: entriesWithSong,
            saved: save,
            song: { title: songTitle, artist: songArtist },
        });
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return jsonError(c, "GENERATE_FAILED", message, 500);
    }
});

// Mount protected routes
app.route("/", protectedApp);

/** 명세 공통 형식: /v1 내 매칭 안 된 경로 → 404 */
app.all("*", (c) => jsonError(c, "NOT_FOUND", "Not found", 404));

export { app as v1App };
