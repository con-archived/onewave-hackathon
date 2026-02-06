/**
 * api-spec 공통 응답 형식 (success/error).
 */

import type { Context } from "hono";

export function jsonSuccess<T>(c: Context, data: T, status = 200) {
    return c.json({ success: true, data }, status as 200);
}

export function jsonError(c: Context, code: string, message: string, status: number) {
    return c.json({ success: false, error: { code, message } }, status as 400);
}
