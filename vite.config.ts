import { cloudflare } from "@cloudflare/vite-plugin";
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";
export default defineWorkersConfig({
    plugins: [cloudflare()],
    build: {
        sourcemap: true,
        lib: {
            entry: "src/index.ts",
            formats: ["es"],
        },
    },
    test: {
        globals: true,
        poolOptions: {
            workers: {
                wrangler: {
                    configPath: "./wrangler.jsonc",
                },
            },
        },

        coverage: {
            enabled: true,
            provider: "istanbul",
            reporter: ["text", "json", "html"],
            include: ["src/**/*.ts"],
        },
    },
    clearScreen: false,
});
