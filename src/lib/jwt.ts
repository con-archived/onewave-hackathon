/**
 * JWT 발급/검증. payload.sub = 내부 user id (UUID).
 * 환경변수: JWT_SECRET
 */

import * as jose from "jose";

const SUB = "sub";
const DEFAULT_ISSUER = "onewave";
const DEFAULT_AUDIENCE = "onewave-api";
const DEFAULT_EXP = "7d";

export interface JwtEnv {
    JWT_SECRET: string;
}

/**
 * 내부 user id로 JWT 발급. exp 기본 7일.
 */
export async function signJwt(
    userId: string,
    env: JwtEnv,
    options?: { expiresIn?: string }
): Promise<string> {
    const secret = new TextEncoder().encode(env.JWT_SECRET);
    return await new jose.SignJWT({ [SUB]: userId })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuer(DEFAULT_ISSUER)
        .setAudience(DEFAULT_AUDIENCE)
        .setSubject(userId)
        .setIssuedAt()
        .setExpirationTime(options?.expiresIn ?? DEFAULT_EXP)
        .sign(secret);
}

export interface JwtPayload {
    sub: string;
}

/**
 * Bearer 토큰 검증 후 payload 반환. 실패 시 null.
 */
export async function verifyJwt(token: string, env: JwtEnv): Promise<JwtPayload | null> {
    try {
        const secret = new TextEncoder().encode(env.JWT_SECRET);
        const { payload } = await jose.jwtVerify(token, secret, {
            issuer: DEFAULT_ISSUER,
            audience: DEFAULT_AUDIENCE,
        });
        const sub = payload.sub ?? (payload[SUB] as string | undefined);
        if (typeof sub !== "string" || !sub) return null;
        return { sub };
    } catch {
        return null;
    }
}
