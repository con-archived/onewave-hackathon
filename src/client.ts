import { hc } from "hono/client";
import type { AppType } from "./index";

/**
 * Example Hono RPC client initialization.
 * This function should be called from the client-side (browser/frontend) only.
 *
 * @param baseUrl - Backend server URL (defaults to environment variable or http://localhost:5174)
 * @returns Typed Hono client instance
 *
 * Usage example:
 *   const client = createClient('http://localhost:5174')
 *   const res = await client.hello.$get()
 *   const data = await res.json()
 */
export function createClient(baseUrl: string = "http://localhost:5174") {
    return hc<AppType>(baseUrl);
}

/**
 * Example usage in component or test:
 *
 * // GET /hello
 * const res = await client.hello.$get()
 * const data = await res.json() // { message: string }
 *
 * // POST /echo
 * const echoRes = await client.echo.$post({
 *   json: { test: 'data' }
 * })
 * const echoData = await echoRes.json() // { echo: any }
 */
