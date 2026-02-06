import type { QueryRunner } from "@/db/settings";

export type NodeDbVariables = { runQuery?: QueryRunner };
type HonoBindings = {
    D1: D1Database;
};
export type HonoCtx = { Variables: NodeDbVariables; Bindings: HonoBindings };
