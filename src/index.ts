import { Hono } from "hono";
import type { QueryRunner } from "./db/settings";
import type { AuthEnv } from "./lib/auth";
import { v1App } from "./routes/v1";
import { cors } from "hono/cors";

/** Node 로컬 서버에서 Postgres 연결 시 주입 (선택). env는 OAuth/JWT용 */
export type NodeDbVariables = { runQuery?: QueryRunner; env?: AuthEnv };

export const app = new Hono<{ Variables: NodeDbVariables }>()
    .use(
        "*",
        cors({
            origin(_, c) {
                const origin = c.req.header("Origin");
                c.res.headers.set("Vary", "Origin");

                return origin;
            },
            credentials: true,
            allowHeaders: ["Authorization", "*"],
            allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        })
    )
    .route("/v1", v1App);

export type AppType = typeof app;

export default app;
