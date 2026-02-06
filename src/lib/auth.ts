/**
 * 인증: Authorization Bearer <JWT> 검증 후 내부 user id 반환.
 * JWT payload.sub = users.id (UUID).
 */

import type { Context } from "hono";
import { verifyJwt, type JwtEnv } from "./jwt";

/** v1 라우트/미들웨어에서 사용. JWT 필수, OAuth는 callback용 선택 */
export interface AuthEnv extends JwtEnv {
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    OAUTH_REDIRECT_URI?: string;
    /** 설정 시 callback 성공 후 해당 URL로 리다이렉트 (#token=...&internal_id=...) */
    FRONTEND_REDIRECT_URI?: string;
}

/**
 * 요청에서 Bearer JWT를 검증하고 내부 user id(sub)를 반환. 실패 시 null.
 */
export async function getUserIdFromRequest(c: Context, env: JwtEnv): Promise<string | null> {
    const auth = c.req.header("Authorization");
    if (!auth || !auth.startsWith("Bearer ")) return null;
    const token = auth.slice(7).trim();
    if (!token) return null;
    const payload = await verifyJwt(token, env);
    return payload?.sub ?? null;
}
