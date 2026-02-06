/**
 * Postgres 연결 테스트. 로컬에서 DB 설정 확인용.
 * 사용: npx tsx scripts/check-db.ts
 * .env 또는 DATABASE_URL 필요.
 */
import "dotenv/config";
import { createPool, checkConnection } from "../src/db/connect";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    console.error(
        "Set DATABASE_URL (e.g. in .env). Example: postgresql://user:pass@localhost:5432/dbname"
    );
    process.exit(1);
}

const pool = createPool(connectionString);
checkConnection(pool)
    .then(() => {
        console.log("OK: Postgres connection successful");
        return pool.end();
    })
    .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        const detail = err instanceof Error && err.stack ? err.stack : msg;
        console.error("FAIL:", msg || "(no message)");
        if (msg !== detail) console.error(detail);
        process.exit(1);
    });
