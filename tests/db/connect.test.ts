/**
 * db/connect.ts 테스트.
 * pg Pool은 mock하여 실제 DB 없이 실행.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPool, createQueryRunner, checkConnection } from "../../src/db/connect";
import type { Pool } from "pg";

const { mockQuery, mockPoolCtor } = vi.hoisted(() => {
    const mockQuery = vi.fn();
    const mockPoolCtor = vi.fn();
    return { mockQuery, mockPoolCtor };
});

vi.mock("pg", () => ({
    Pool: class {
        query = mockQuery;
        constructor(config: unknown) {
            mockPoolCtor(config);
        }
    },
}));

describe("db/connect", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("createPool", () => {
        it("should create a Pool with given connectionString and options", () => {
            const conn = "postgresql://user:pass@localhost:5432/mydb";
            createPool(conn);

            expect(mockPoolCtor).toHaveBeenCalledTimes(1);
            expect(mockPoolCtor).toHaveBeenCalledWith({
                connectionString: conn,
                max: 10,
                idleTimeoutMillis: 30000,
                connectionTimeoutMillis: 5000,
            });
        });
    });

    describe("createQueryRunner", () => {
        it("should return a function that runs pool.query and returns { rows }", async () => {
            const mockRows = [{ id: "1", name: "test" }];
            mockQuery.mockResolvedValueOnce({ rows: mockRows });

            const pool = createPool("postgresql://localhost/db") as Pool;
            const runner = createQueryRunner(pool);
            const result = await runner("SELECT * FROM t WHERE id = $1", ["1"]);

            expect(mockQuery).toHaveBeenCalledWith("SELECT * FROM t WHERE id = $1", ["1"]);
            expect(result).toEqual({ rows: mockRows });
        });

        it("should return empty rows array when result.rows is undefined", async () => {
            mockQuery.mockResolvedValueOnce({ rows: undefined });

            const pool = createPool("postgresql://localhost/db") as Pool;
            const runner = createQueryRunner(pool);
            const result = await runner("SELECT 1", []);

            expect(result).toEqual({ rows: [] });
        });
    });

    describe("checkConnection", () => {
        it("should not throw when pool returns rows[0].ok === 1", async () => {
            mockQuery.mockResolvedValueOnce({ rows: [{ ok: 1 }] });

            const pool = createPool("postgresql://localhost/db") as Pool;
            await expect(checkConnection(pool)).resolves.toBeUndefined();
            expect(mockQuery).toHaveBeenCalledWith("SELECT 1 as ok");
        });

        it("should throw when rows is empty", async () => {
            mockQuery.mockResolvedValueOnce({ rows: [] });

            const pool = createPool("postgresql://localhost/db") as Pool;
            await expect(checkConnection(pool)).rejects.toThrow(
                "DB check query returned unexpected result"
            );
        });

        it("should throw when rows[0].ok is not 1", async () => {
            mockQuery.mockResolvedValueOnce({ rows: [{ ok: 0 }] });

            const pool = createPool("postgresql://localhost/db") as Pool;
            await expect(checkConnection(pool)).rejects.toThrow(
                "DB check query returned unexpected result"
            );
        });

        it("should throw when rows[0] has no ok property", async () => {
            mockQuery.mockResolvedValueOnce({ rows: [{}] });

            const pool = createPool("postgresql://localhost/db") as Pool;
            await expect(checkConnection(pool)).rejects.toThrow(
                "DB check query returned unexpected result"
            );
        });
    });
});
