/**
 * UUID 생성 유틸리티.
 * D1 (SQLite)는 데이터베이스 레벨에서 UUID 생성을 지원하지 않으므로
 * 애플리케이션 레벨에서 생성해야 합니다.
 */

/**
 * RFC 4122 v4 UUID 생성.
 * Cloudflare Workers 환경에서 crypto.randomUUID() 사용.
 */
export function generateUUID(): string {
    return crypto.randomUUID();
}

/**
 * UUID 형식 검증.
 */
export function isValidUUID(uuid: string): boolean {
    const regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return regex.test(uuid);
}
