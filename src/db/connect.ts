/**
 * 로컬/Node 환경에서 PostgreSQL 직접 연결.
 * Worker 배포 시에는 Hyperdrive로 runQuery를 구현해 주입하면 됨.
 */

import { Pool } from "pg";
import type { QueryRunner } from "./settings";

/**
 * connectionString으로 Pool 생성.
 * @param connectionString - 예: postgresql://user:pass@localhost:5432/dbname
 */
export function createPool(connectionString: string): Pool {
    return new Pool({
        connectionString,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
    });
}

/**
 * pg Pool을 사용하는 QueryRunner 생성.
 * settings.ts의 getVocabularySettings, saveVocabularyList 등에 넘길 수 있음.
 */
export function createQueryRunner(pool: Pool): QueryRunner {
    return async (sql: string, params: unknown[]): Promise<{ rows: unknown[] }> => {
        const result = await pool.query(sql, params);
        return { rows: result.rows ?? [] };
    };
}

/**
 * 연결 테스트: SELECT 1 실행.
 * 연결 실패 시 에러 throw.
 */
export async function checkConnection(pool: Pool): Promise<void> {
    const result = await pool.query("SELECT 1 as ok");
    if (!result.rows?.[0] || (result.rows[0] as { ok?: number }).ok !== 1) {
        throw new Error("DB check query returned unexpected result");
    }
}
