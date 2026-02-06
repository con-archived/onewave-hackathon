import { describe, it, expect } from "vitest";
import * as z from "zod";
import { generateText, generateStructured, type GeminiEnv } from "../src/lib/gemini";

/**
 * Integration tests for gemini.ts using real API calls
 *
 * These tests will be SKIPPED unless SECRET_GEMINI_API_KEY is set in the environment.
 * To run these tests with a real API key:
 *
 * ```bash
 * SECRET_GEMINI_API_KEY="your-actual-api-key" npm test
 * ```
 *
 * Or set it in your .env file (for local development).
 */

const getApiKey = (): string | undefined => {
    return process.env.SECRET_GEMINI_API_KEY;
};

const hasApiKey = (): boolean => {
    const apiKey = getApiKey();
    return Boolean(apiKey && apiKey.trim().length > 0);
};

describe("gemini integration tests (real API)", () => {
    describe("generateStructured", () => {
        it.skipIf(!hasApiKey())(
            "should generate structured output with a simple schema",
            async () => {
                const testSchema = z.object({
                    title: z.string(),
                    count: z.number(),
                    isActive: z.boolean(),
                });

                const env: GeminiEnv = {
                    SECRET_GEMINI_API_KEY: getApiKey()!,
                };

                const result = await generateStructured(
                    "Generate a response with title: 'Test Item', count: 42, and isActive: true",
                    testSchema,
                    env
                );

                // Verify the result matches the schema structure
                expect(result).toBeDefined();
                expect(typeof result.title).toBe("string");
                expect(typeof result.count).toBe("number");
                expect(typeof result.isActive).toBe("boolean");

                // Verify schema validation passes
                const parsed = testSchema.safeParse(result);
                expect(parsed.success).toBe(true);
            }
        );

        it.skipIf(!hasApiKey())(
            "should generate structured output with nested schema",
            async () => {
                const testSchema = z.object({
                    user: z.object({
                        name: z.string(),
                        age: z.number(),
                    }),
                    tags: z.array(z.string()),
                    score: z.number(),
                });

                const env: GeminiEnv = {
                    SECRET_GEMINI_API_KEY: getApiKey()!,
                };

                const result = await generateStructured(
                    "Generate a user with name 'Alice', age 25, tags ['developer', 'ai'], and score 95",
                    testSchema,
                    env
                );

                // Verify the result structure
                expect(result).toBeDefined();
                expect(result.user).toBeDefined();
                expect(typeof result.user.name).toBe("string");
                expect(typeof result.user.age).toBe("number");
                expect(Array.isArray(result.tags)).toBe(true);
                expect(typeof result.score).toBe("number");

                // Verify schema validation passes
                const parsed = testSchema.safeParse(result);
                expect(parsed.success).toBe(true);
            }
        );

        it.skipIf(!hasApiKey())("should handle enum-like string values", async () => {
            const testSchema = z.object({
                status: z.enum(["pending", "active", "completed"]),
                priority: z.number().min(1).max(5),
            });

            const env: GeminiEnv = {
                SECRET_GEMINI_API_KEY: getApiKey()!,
            };

            const result = await generateStructured(
                "Generate a task with status 'active' and priority 3",
                testSchema,
                env
            );

            // Verify the result
            expect(result).toBeDefined();
            expect(["pending", "active", "completed"]).toContain(result.status);
            expect(result.priority).toBeGreaterThanOrEqual(1);
            expect(result.priority).toBeLessThanOrEqual(5);

            // Verify schema validation passes
            const parsed = testSchema.safeParse(result);
            expect(parsed.success).toBe(true);
        });

        it.skipIf(!hasApiKey())("should use custom model when specified", async () => {
            const testSchema = z.object({
                word: z.string(),
                definition: z.string(),
            });

            const env: GeminiEnv = {
                SECRET_GEMINI_API_KEY: getApiKey()!,
                GEMINI_MODEL: "gemini-flash-lite-latest",
            };

            const result = await generateStructured(
                "Generate a word 'hello' and its definition",
                testSchema,
                env
            );

            expect(result).toBeDefined();
            expect(typeof result.word).toBe("string");
            expect(typeof result.definition).toBe("string");

            // Verify schema validation passes
            const parsed = testSchema.safeParse(result);
            expect(parsed.success).toBe(true);
        });
    });

    describe("generateText", () => {
        it.skipIf(!hasApiKey())("should stream text chunks", async () => {
            const env: GeminiEnv = {
                SECRET_GEMINI_API_KEY: getApiKey()!,
            };

            const chunks: string[] = [];
            for await (const chunk of generateText("Say 'Hello, World!'", env)) {
                chunks.push(chunk);
            }

            // Should receive at least some chunks
            expect(chunks.length).toBeGreaterThan(0);

            // The combined text should contain our expected content
            const fullText = chunks.join("");
            expect(fullText).toBeTruthy();
            expect(fullText.length).toBeGreaterThan(0);
        });

        it.skipIf(!hasApiKey())("should handle longer prompts", async () => {
            const env: GeminiEnv = {
                SECRET_GEMINI_API_KEY: getApiKey()!,
            };

            const prompt = "Write a very short haiku about programming (3 lines, 5-7-5 syllables)";

            const chunks: string[] = [];
            for await (const chunk of generateText(prompt, env)) {
                chunks.push(chunk);
            }

            const fullText = chunks.join("");
            expect(fullText).toBeTruthy();
            expect(fullText.length).toBeGreaterThan(0);
        });
    });

    describe("error handling", () => {
        it.skipIf(!hasApiKey())("should throw error with invalid API key", async () => {
            const testSchema = z.object({
                result: z.string(),
            });

            const env: GeminiEnv = {
                SECRET_GEMINI_API_KEY: "invalid-key-12345",
            };

            await expect(
                generateStructured("Generate something", testSchema, env)
            ).rejects.toThrow();
        });

        it.skipIf(!hasApiKey())("should handle empty prompt gracefully", async () => {
            const testSchema = z.object({
                text: z.string(),
            });

            const env: GeminiEnv = {
                SECRET_GEMINI_API_KEY: getApiKey()!,
            };

            // The API should handle empty prompts - may throw or return empty result
            const result = await generateStructured("", testSchema, env);
            expect(result).toBeDefined();
        });
    });
});
