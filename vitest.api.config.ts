/**
 * API 통합 테스트용 Vitest 설정 (실제 DB 사용).
 * Node 풀 사용 — pg, dotenv 동작.
 * 실행: npm run test:api
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        globals: true,
        pool: "forks",
        include: ["tests/v1.integration.test.ts"],
        environment: "node",
    },
});
