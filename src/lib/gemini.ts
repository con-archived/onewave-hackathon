import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { streamText, generateText as generateTextVercel, Output } from "ai";
import * as z from "zod";

const DEFAULT_MODEL = "gemini-3-flash-preview";

// Environment interface for Gemini API configuration
export interface GeminiEnv {
    SECRET_GEMINI_API_KEY: string;
    GEMINI_MODEL?: string;
    GEMINI_BASE_URL?: string;
}

/**
 * Generate text from Gemini API with streaming support using Vercel AI SDK
 * @param prompt - The text prompt to send to Gemini
 * @param env - Environment object containing API key and optional configuration
 * @yields Text chunks as they arrive from the API
 */
export async function* generateText(
    prompt: string,
    env?: GeminiEnv
): AsyncGenerator<string, void, unknown> {
    const apiKey = env?.SECRET_GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error("SECRET_GEMINI_API_KEY environment variable is not set");
    }

    const modelName = env?.GEMINI_MODEL ?? DEFAULT_MODEL;

    // Create model with optional custom baseURL
    const model = createGoogleGenerativeAI({ apiKey, baseURL: env?.GEMINI_BASE_URL })(modelName);

    const result = streamText({
        model,
        prompt,
    });

    for await (const chunk of result.textStream) {
        yield chunk;
    }
}

/**
 * Generate structured data from Gemini API based on a Zod schema
 * Uses prompt engineering approach for structured output
 * @param prompt - The text prompt to send to Gemini
 * @param schema - Zod schema defining the expected output structure
 * @param env - Environment object containing API key and optional configuration
 * @returns Parsed and validated data matching the Zod schema
 */
export async function generateStructured<const T extends z.ZodObject>(
    prompt: string,
    schema: T,
    env?: GeminiEnv
): Promise<z.infer<T>> {
    const apiKey = env?.SECRET_GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error("SECRET_GEMINI_API_KEY environment variable is not set");
    }

    const modelName = env?.GEMINI_MODEL ?? DEFAULT_MODEL;

    // Create model with optional custom baseURL
    const model = createGoogleGenerativeAI({ apiKey, baseURL: env?.GEMINI_BASE_URL })(modelName);

    // Add schema instruction to prompt

    const result = await generateTextVercel({
        model,
        prompt,
        output: Output.object({ schema }),
    });
    return schema.parse(result.output);
}
