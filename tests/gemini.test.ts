import { describe, it, expect, beforeEach, vi } from "vitest";
import { z } from "zod";

// Mock @ai-sdk/google - must be at top level before imports
vi.mock("@ai-sdk/google", () => ({
    createGoogleGenerativeAI: vi.fn(() => (_model: string) => vi.fn()) as never,
}));

// Mock ai package
vi.mock("ai", () => ({
    streamText: vi.fn(),
    generateText: vi.fn(),
    Output: {
        object: vi.fn((config: { schema: z.ZodUnknown }) => ({ schema: config.schema })),
    },
}));

import { generateText, generateStructured, type GeminiEnv } from "../src/lib/gemini";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { streamText, generateText as generateTextVercel } from "ai";

// Mock environment
const MOCK_API_KEY = "test-gemini-api-key";
const mockEnv: GeminiEnv = {
    SECRET_GEMINI_API_KEY: MOCK_API_KEY,
    GEMINI_MODEL: "gemini-flash-lite-latest",
    GEMINI_BASE_URL: "https://custom.example.com",
};

// Helper to create a mock text stream
const createMockTextStream = (chunks: string[]) => {
    return (async function* () {
        for (const chunk of chunks) {
            yield chunk;
        }
    })();
};

describe("gemini", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("generateText", () => {
        it("should yield text chunks from the stream", async () => {
            const mockStream = { textStream: createMockTextStream(["Hello", " ", "world", "!"]) };
            vi.mocked(streamText).mockReturnValue(mockStream as never);

            const chunks: string[] = [];
            for await (const chunk of generateText("test prompt", mockEnv)) {
                chunks.push(chunk);
            }

            expect(chunks).toEqual(["Hello", " ", "world", "!"]);
        });

        it("should use default model when not specified", async () => {
            let capturedModel: string | undefined;
            let capturedApiKey: string | undefined;

            vi.mocked(createGoogleGenerativeAI).mockImplementation(
                (config) =>
                    ((model: string) => {
                        capturedModel = model;
                        capturedApiKey = config?.apiKey;
                        return vi.fn();
                    }) as never
            );
            vi.mocked(streamText).mockReturnValue({
                textStream: createMockTextStream(["test"]),
            } as never);

            const envWithoutModel: GeminiEnv = {
                SECRET_GEMINI_API_KEY: MOCK_API_KEY,
            };

            for await (const _chunk of generateText("test", envWithoutModel)) {
                break;
            }

            expect(capturedModel).toBe("gemini-flash-lite-latest");
            expect(capturedApiKey).toBe(MOCK_API_KEY);
        });

        it("should use custom model when specified", async () => {
            let capturedModel: string | undefined;

            vi.mocked(createGoogleGenerativeAI).mockImplementation(
                () =>
                    ((model: string) => {
                        capturedModel = model;
                        return vi.fn();
                    }) as never
            );
            vi.mocked(streamText).mockReturnValue({
                textStream: createMockTextStream(["test"]),
            } as never);

            for await (const _chunk of generateText("test", mockEnv)) {
                break;
            }

            expect(capturedModel).toBe("gemini-flash-lite-latest");
        });

        it("should pass prompt to streamText", async () => {
            vi.mocked(createGoogleGenerativeAI).mockImplementation((() => () => vi.fn()) as never);
            vi.mocked(streamText).mockReturnValue({
                textStream: createMockTextStream(["result"]),
            } as never);

            const simpleEnv: GeminiEnv = {
                SECRET_GEMINI_API_KEY: MOCK_API_KEY,
            };

            for await (const _chunk of generateText("Write a haiku", simpleEnv)) {
                break;
            }

            expect(streamText).toHaveBeenCalledWith(
                expect.objectContaining({
                    prompt: "Write a haiku",
                })
            );
        });

        it("should throw error when API key is not provided", async () => {
            const gen = generateText("test");

            let errorThrown = false;
            try {
                for await (const _chunk of gen) {
                    // Should not reach here
                }
            } catch (error) {
                errorThrown = true;
                expect(error).toEqual(
                    expect.objectContaining({
                        message: "SECRET_GEMINI_API_KEY environment variable is not set",
                    })
                );
            }

            expect(errorThrown).toBe(true);
        });

        it("should throw error when API key is empty string", async () => {
            const envWithEmptyKey: GeminiEnv = {
                SECRET_GEMINI_API_KEY: "",
            };

            const gen = generateText("test", envWithEmptyKey);

            let errorThrown = false;
            try {
                for await (const _chunk of gen) {
                    // Should not reach here
                }
            } catch (error) {
                errorThrown = true;
                expect(error).toEqual(
                    expect.objectContaining({
                        message: "SECRET_GEMINI_API_KEY environment variable is not set",
                    })
                );
            }

            expect(errorThrown).toBe(true);
        });

        it("should handle empty stream", async () => {
            vi.mocked(createGoogleGenerativeAI).mockImplementation((() => () => vi.fn()) as never);
            vi.mocked(streamText).mockReturnValue({
                textStream: createMockTextStream([]),
            } as never);

            const chunks: string[] = [];
            for await (const chunk of generateText("test", mockEnv)) {
                chunks.push(chunk);
            }

            expect(chunks).toEqual([]);
        });

        it("should accumulate all chunks from stream", async () => {
            const words = ["The", "quick", "brown", "fox", "jumps"];
            vi.mocked(createGoogleGenerativeAI).mockImplementation((() => () => vi.fn()) as never);
            vi.mocked(streamText).mockReturnValue({
                textStream: createMockTextStream(words),
            } as never);

            const fullText: string[] = [];
            for await (const chunk of generateText("Tell me a story", mockEnv)) {
                fullText.push(chunk);
            }

            expect(fullText).toEqual(words);
        });

        it("should pass custom baseURL to createGoogleGenerativeAI", async () => {
            let capturedBaseURL: string | undefined;

            vi.mocked(createGoogleGenerativeAI).mockImplementation(((
                config: { baseURL?: string } | undefined
            ) => {
                capturedBaseURL = config?.baseURL;
                return () => vi.fn();
            }) as never);
            vi.mocked(streamText).mockReturnValue({
                textStream: createMockTextStream(["test"]),
            } as never);

            for await (const _ of generateText("test", mockEnv)) {
                break;
            }

            expect(capturedBaseURL).toBe("https://custom.example.com");
        });
    });

    describe("generateStructured", () => {
        it("should generate structured output matching Zod schema", async () => {
            const testSchema = z.object({
                name: z.string(),
                age: z.number(),
                active: z.boolean(),
            });

            const mockOutput = { name: "John Doe", age: 30, active: true };
            vi.mocked(createGoogleGenerativeAI).mockImplementation((() => () => vi.fn()) as never);
            vi.mocked(generateTextVercel).mockResolvedValue({
                output: mockOutput,
            } as never);

            const result = await generateStructured("Generate a user profile", testSchema, mockEnv);

            expect(result).toEqual(mockOutput);
        });

        it("should throw error when API key is not provided", async () => {
            const testSchema = z.object({
                name: z.string(),
            });

            await expect(generateStructured("test", testSchema)).rejects.toThrow(
                "SECRET_GEMINI_API_KEY environment variable is not set"
            );
        });

        it("should use default model when not specified", async () => {
            const testSchema = z.object({ title: z.string() });
            const envWithoutModel: GeminiEnv = {
                SECRET_GEMINI_API_KEY: MOCK_API_KEY,
            };

            let capturedModel: string | undefined;
            vi.mocked(createGoogleGenerativeAI).mockImplementation(
                () =>
                    ((model: string) => {
                        capturedModel = model;
                        return vi.fn();
                    }) as never
            );
            vi.mocked(generateTextVercel).mockResolvedValue({
                output: { title: "Test" },
            } as never);

            await generateStructured("test", testSchema, envWithoutModel);

            expect(capturedModel).toBe("gemini-flash-lite-latest");
        });

        it("should use custom model when specified", async () => {
            const testSchema = z.object({ title: z.string() });

            let capturedModel: string | undefined;
            vi.mocked(createGoogleGenerativeAI).mockImplementation(
                () =>
                    ((model: string) => {
                        capturedModel = model;
                        return vi.fn();
                    }) as never
            );
            vi.mocked(generateTextVercel).mockResolvedValue({
                output: { title: "Test" },
            } as never);

            await generateStructured("test", testSchema, mockEnv);

            expect(capturedModel).toBe("gemini-flash-lite-latest");
        });

        it("should pass output with schema to generateTextVercel", async () => {
            const testSchema = z.object({ count: z.number(), items: z.array(z.string()) });

            vi.mocked(createGoogleGenerativeAI).mockImplementation((() => () => vi.fn()) as never);
            vi.mocked(generateTextVercel).mockResolvedValue({
                output: { count: 3, items: ["a", "b", "c"] },
            } as never);

            await generateStructured("Generate a list", testSchema, mockEnv);

            expect(generateTextVercel).toHaveBeenCalledWith(
                expect.objectContaining({
                    output: expect.objectContaining({
                        schema: testSchema,
                    }),
                })
            );
        });

        it("should parse output with provided schema", async () => {
            const testSchema = z.object({
                email: z.string().email(),
                verified: z.boolean(),
            });

            const mockRawOutput = { email: "test@example.com", verified: true };
            const parseSpy = vi.spyOn(testSchema, "parse").mockReturnValue(mockRawOutput);

            vi.mocked(createGoogleGenerativeAI).mockImplementation((() => () => vi.fn()) as never);
            vi.mocked(generateTextVercel).mockResolvedValue({
                output: mockRawOutput,
            } as never);

            const result = await generateStructured("Generate user", testSchema, mockEnv);

            expect(parseSpy).toHaveBeenCalledWith(mockRawOutput);
            expect(result).toEqual(mockRawOutput);
            parseSpy.mockRestore();
        });
    });
});
