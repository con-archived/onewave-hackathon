/**
 * API v1 통합 테스트 (실제 DB 사용).
 * DATABASE_URL, JWT_SECRET이 설정되어 있고 Postgres가 떠 있어야 합니다.
 * 실행: npm run test:api
 *
 * 사전: npm run db:up && npm run db:init && npm run db:check
 */
import "dotenv/config";
import { describe, it, expect, beforeAll } from "vitest";
import { Hono } from "hono";
import { app } from "../src/index";
import { createPool, createQueryRunner } from "../src/db/connect";
import { syncUserFromOAuth } from "../src/db/users";
import { signJwt } from "../src/lib/jwt";
import type { NodeDbVariables } from "../src/index";
import type { QueryRunner } from "../src/db/settings";

const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET ?? "test-jwt-secret-for-integration-tests";
const hasDb = Boolean(DATABASE_URL?.trim());

async function request(
    testApp: Hono<{ Variables: NodeDbVariables }>,
    method: string,
    path: string,
    options?: { headers?: Record<string, string>; body?: object }
): Promise<{ status: number; json: () => Promise<unknown> }> {
    const url = path.startsWith("http") ? path : `http://localhost${path}`;
    const res = await testApp.request(url, {
        method,
        headers: {
            "Content-Type": "application/json",
            ...options?.headers,
        },
        body: options?.body ? JSON.stringify(options.body) : undefined,
    });
    return {
        status: res.status,
        json: () => res.json(),
    };
}

describe("v1 API integration (real DB)", () => {
    let testApp: Hono<{ Variables: NodeDbVariables }>;
    let runQuery: QueryRunner;
    let token: string;

    beforeAll(async () => {
        if (!hasDb) return;
        const pool = createPool(DATABASE_URL!);
        runQuery = createQueryRunner(pool);
        const authEnv: NodeDbVariables["env"] = {
            JWT_SECRET,
            GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
            GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
            OAUTH_REDIRECT_URI: process.env.OAUTH_REDIRECT_URI,
        };
        testApp = new Hono<{ Variables: NodeDbVariables }>()
            .use("*", async (c, next) => {
                c.set("runQuery", runQuery);
                c.set("env", authEnv);
                return next();
            })
            .route("/", app);

        const providerUserId = `test-google-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const { internal_id } = await syncUserFromOAuth("google", providerUserId, runQuery);
        token = await signJwt(internal_id, { JWT_SECRET });
    });

    const auth = () => ({ Authorization: `Bearer ${token}` });

    describe("auth & profile", () => {
        it.skipIf(!hasDb)("GET /v1/user/profile returns 200 and settings with JWT", async () => {
            const res = await request(testApp, "GET", "/v1/user/profile", {
                headers: auth(),
            });
            expect(res.status).toBe(200);
            const data = (await res.json()) as {
                success?: boolean;
                data?: {
                    id?: string;
                    display_name?: string | null;
                    email?: string | null;
                    settings?: {
                        language?: string;
                        level?: string;
                        max_words?: number;
                        min_length?: number;
                    };
                };
            };
            expect(data.success).toBe(true);
            expect(data.data?.id).toBeDefined();
            expect(data.data?.settings).toBeDefined();
            expect(data.data?.settings?.language).toBeDefined();
            expect(data.data?.settings?.level).toBeDefined();
            expect(data.data?.settings?.max_words).toBeDefined();
            expect(data.data?.settings?.min_length).toBeDefined();
        });
    });

    describe("user settings", () => {
        it.skipIf(!hasDb)("PATCH /v1/user/settings returns 200 and updated settings", async () => {
            const res = await request(testApp, "PATCH", "/v1/user/settings", {
                headers: auth(),
                body: { language: "ko", level: "advanced", max_words: 50 },
            });
            expect(res.status).toBe(200);
            const data = (await res.json()) as {
                success?: boolean;
                data?: {
                    language?: string;
                    level?: string;
                    max_words?: number;
                    min_length?: number;
                };
            };
            expect(data.success).toBe(true);
            expect(data.data?.language).toBe("ko");
            expect(data.data?.level).toBe("advanced");
            expect(data.data?.max_words).toBe(50);
        });
    });

    describe("music history", () => {
        it.skipIf(!hasDb)("POST /v1/music/history returns 201 with id and created_at", async () => {
            const res = await request(testApp, "POST", "/v1/music/history", {
                headers: auth(),
                body: {
                    video_id: "dQw4w9WgXcQ",
                    title: "Test Song",
                    capture_time: 42,
                    origin: "YouTube",
                },
            });
            expect(res.status).toBe(201);
            const data = (await res.json()) as {
                success?: boolean;
                data?: { id?: string; created_at?: string };
            };
            expect(data.success).toBe(true);
            expect(data.data?.id).toBeDefined();
            expect(data.data?.created_at).toBeDefined();
        });

        it.skipIf(!hasDb)("GET /v1/music/history returns 200 and array", async () => {
            const res = await request(testApp, "GET", "/v1/music/history", {
                headers: auth(),
            });
            expect(res.status).toBe(200);
            const data = (await res.json()) as { success?: boolean; data?: unknown[] };
            expect(data.success).toBe(true);
            expect(Array.isArray(data.data)).toBe(true);
        });
    });

    describe("vocabulary & user words", () => {
        it.skipIf(!hasDb)("GET /v1/vocabulary/lists returns 200 and array", async () => {
            const res = await request(testApp, "GET", "/v1/vocabulary/lists", {
                headers: auth(),
            });
            expect(res.status).toBe(200);
            const data = (await res.json()) as { success?: boolean; data?: unknown[] };
            expect(data.success).toBe(true);
            expect(Array.isArray(data.data)).toBe(true);
        });

        it.skipIf(!hasDb)("GET /v1/user/words returns 200 and array", async () => {
            const res = await request(testApp, "GET", "/v1/user/words", {
                headers: auth(),
            });
            expect(res.status).toBe(200);
            const data = (await res.json()) as { success?: boolean; data?: unknown[] };
            expect(data.success).toBe(true);
            expect(Array.isArray(data.data)).toBe(true);
        });
    });

    describe("vocabulary/generate", () => {
        const hasGemini = Boolean(
            (process.env.GEMINI_API_KEY ?? process.env.SECRET_GEMINI_API_KEY)?.trim()
        );
        const hasGenius = Boolean(
            (process.env.GENIUS_API_KEY ?? process.env.SECRET_GENIUS_API_KEY)?.trim()
        );

        it.skipIf(!hasDb || !hasGemini || !hasGenius)(
            "POST /v1/vocabulary/generate returns 200 with entries when song_title provided",
            async () => {
                const res = await request(testApp, "POST", "/v1/vocabulary/generate", {
                    headers: auth(),
                    body: { song_title: "Shake It Off Taylor Swift", save: false },
                });
                expect(res.status).toBe(200);
                const data = (await res.json()) as {
                    success?: boolean;
                    data?: {
                        entries?: Array<{
                            word?: string;
                            score?: number;
                            meaning?: string;
                            example?: string;
                            synonyms?: string[];
                            occurrences?: number;
                            songTitle?: string;
                            songArtist?: string;
                        }>;
                        saved?: boolean;
                        song?: { title?: string; artist?: string };
                    };
                };
                expect(data.success).toBe(true);
                expect(data.data?.saved).toBe(false);
                expect(data.data?.song?.title).toBeDefined();
                expect(data.data?.song?.artist).toBeDefined();
                const entries = data.data?.entries;
                expect(Array.isArray(entries)).toBe(true);
                expect((entries?.length ?? 0) > 0).toBe(true);
                for (const entry of entries ?? []) {
                    expect(entry).toBeDefined();
                    expect(typeof (entry as { word?: unknown }).word).toBe("string");
                    expect((entry as { word: string }).word.length).toBeGreaterThan(0);
                    // 각 엔트리에 곡 정보가 포함되어 있는지 확인
                    expect((entry as { songTitle?: unknown }).songTitle).toBe(data.data?.song?.title);
                    expect((entry as { songArtist?: unknown }).songArtist).toBe(data.data?.song?.artist);
                }
            },
            25000
        );

        it.skipIf(!hasDb)(
            "POST /v1/vocabulary/generate returns 400 when song_title missing",
            async () => {
                const res = await request(testApp, "POST", "/v1/vocabulary/generate", {
                    headers: auth(),
                    body: {},
                });
                expect(res.status).toBe(400);
                const data = (await res.json()) as {
                    success?: boolean;
                    error?: { code?: string; message?: string };
                };
                expect(data.success).toBe(false);
                expect(data.error?.code).toBeDefined();
                expect(data.error?.message).toMatch(/song_title/i);
            }
        );
    });

    describe("errors", () => {
        it.skipIf(!hasDb)("returns 401 when Authorization missing", async () => {
            const res = await request(testApp, "GET", "/v1/user/profile");
            expect(res.status).toBe(401);
            const data = (await res.json()) as { success?: boolean; error?: { code?: string } };
            expect(data.success).toBe(false);
            expect(data.error?.code).toBeDefined();
        });

        it.skipIf(!hasDb)("returns 404 for unknown path under /v1", async () => {
            const res = await request(testApp, "GET", "/v1/unknown/path", {
                headers: auth(),
            });
            expect(res.status).toBe(404);
            const data = (await res.json()) as { success?: boolean; error?: { code?: string } };
            expect(data.success).toBe(false);
        });

        it.skipIf(!hasDb)("POST /v1/music/history returns 400 when video_id missing", async () => {
            const res = await request(testApp, "POST", "/v1/music/history", {
                headers: auth(),
                body: { title: "No video id" },
            });
            expect(res.status).toBe(400);
            const data = (await res.json()) as { success?: boolean; error?: { message?: string } };
            expect(data.success).toBe(false);
            expect(data.error?.message).toMatch(/video_id/i);
        });
    });
});
