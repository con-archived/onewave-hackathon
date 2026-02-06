import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import ts from "typescript-eslint";
import globals from "globals";
import { defineConfig } from "eslint/config";

export default defineConfig(
    { ignores: ["dist", "coverage", "node_modules", ".wrangler", "worker-configuration.d.ts"] },
    js.configs.recommended,
    ...ts.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2022,
            globals: {
                ...globals.node,
                ...globals.serviceworker,
            },
        },
        rules: {
            "@typescript-eslint/no-unused-vars": [
                "warn",
                { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
            ],
            "@typescript-eslint/no-explicit-any": "warn",
            "no-console": "warn",
            "@typescript-eslint/ban-ts-comment": "off",
        },
    },
    prettier
);
