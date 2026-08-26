import eslint from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";
import tseslint from "typescript-eslint";

export default tseslint.config(
    {
        ignores: ["dist/**", "coverage/**", "node_modules/**"]
    },
    {
        files: ["src/**/*.ts", "src/**/*.tsx", "tests/**/*.ts", "tests/**/*.tsx", "vitest.config.ts"],
        extends: [eslint.configs.recommended, ...tseslint.configs.strictTypeChecked],
        plugins: { "@stylistic": stylistic },
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname
            }
        },
        rules: {
            "@stylistic/indent": ["error", 4, { SwitchCase: 1 }]
        }
    },
    {
        ...eslint.configs.recommended,
        files: ["eslint.config.ts", "rspack.config.ts", "scripts/**/*.ts"],
        plugins: { "@stylistic": stylistic },
        languageOptions: {
            parser: tseslint.parser,
            ecmaVersion: "latest",
            sourceType: "module",
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname
            },
            globals: {
                console: "readonly",
                process: "readonly",
                setTimeout: "readonly",
                clearTimeout: "readonly"
            }
        },
        rules: {
            "@stylistic/indent": ["error", 4, { SwitchCase: 1 }]
        }
    }
);
