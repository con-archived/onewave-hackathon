import { describe, expect, it } from "vitest";

describe("Example Test", () => {
    it("should pass this example test", async () => {
        // env contains bindings from wrangler.jsonc
        expect(1 + 1).toBe(2);
    });
});
