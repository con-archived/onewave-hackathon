/**
 * Node에서 백엔드 실행 (로컬 개발용).
 * DATABASE_URL 있으면 Postgres 연결, 없으면 DB 없이 실행 (나중에 Hyperdrive 쓸 때도 동일하게 사용).
 */
import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { app } from "./index";
import { createPool, createQueryRunner } from "./db/connect";
import type { NodeDbVariables } from "./index";
import type { QueryRunner } from "./db/settings";

const PORT = Number(process.env.PORT) || 5174;
const connectionString = process.env.DATABASE_URL;

let runQuery: QueryRunner | undefined;
if (connectionString) {
    const pool = createPool(connectionString);
    runQuery = createQueryRunner(pool);
}

const authEnv: NodeDbVariables["env"] = {
    JWT_SECRET: process.env.JWT_SECRET ?? "",
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    OAUTH_REDIRECT_URI: process.env.OAUTH_REDIRECT_URI,
    FRONTEND_REDIRECT_URI: process.env.FRONTEND_REDIRECT_URI,
};

const serverApp = new Hono<{ Variables: NodeDbVariables }>()
    .use("*", async (c, next) => {
        c.set("runQuery", runQuery);
        c.set("env", authEnv);
        return next();
    })
    .use("*", async (c, next) => {
        c.header("Access-Control-Allow-Origin", "*");
        c.header("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
        c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
        return next();
    })
    .options("*", (c) => c.body(null, 204));
serverApp.route("/", app);

serve({ fetch: serverApp.fetch, port: PORT }, (info) => {
    const dbStatus = runQuery
        ? "Postgres connected"
        : "DB not configured (set DATABASE_URL to enable)";
    console.log(`Server running at http://localhost:${info.port} (${dbStatus})`);
});
