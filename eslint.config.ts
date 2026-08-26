/**
 * @file Lint configuration for TypeScript correctness, formatting, and public API documentation.
 */

import eslint from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";
import type { Linter } from "eslint";
import jsdoc from "eslint-plugin-jsdoc";
import tseslint from "typescript-eslint";

const jsdocRules = {
    "jsdoc/multiline-blocks": ["error", { noSingleLineBlocks: true }],
    "jsdoc/check-alignment": "error",
    "jsdoc/lines-before-block": "error",
    "jsdoc/tag-lines": ["error", "any", { startLines: 1 }],
    "jsdoc/require-file-overview": "error",
    "jsdoc/require-jsdoc": [
        "error",
        {
            enableFixer: true,
            require: {
                ClassDeclaration: true,
                MethodDefinition: true,
                FunctionDeclaration: true
            },
            contexts: [
                "TSInterfaceDeclaration",
                "TSTypeAliasDeclaration",
                "TSInterfaceDeclaration TSPropertySignature",
                "TSInterfaceDeclaration TSMethodSignature",
                "PropertyDefinition",
                "ExportNamedDeclaration[declaration.type='VariableDeclaration']"
            ],
            checkConstructors: true,
            exemptEmptyConstructors: true
        }
    ],
    "jsdoc/require-description": [
        "error",
        {
            descriptionStyle: "body",
            checkConstructors: true,
            checkGetters: true,
            checkSetters: true,
            contexts: [
                "ClassDeclaration",
                "FunctionDeclaration",
                "MethodDefinition",
                "PropertyDefinition",
                "TSInterfaceDeclaration",
                "TSTypeAliasDeclaration",
                "TSInterfaceDeclaration TSPropertySignature",
                "TSInterfaceDeclaration TSMethodSignature",
                "ExportNamedDeclaration[declaration.type='VariableDeclaration']"
            ]
        }
    ],
    "jsdoc/require-param-description": "error",
    "jsdoc/require-returns-description": "error",
    "jsdoc/require-param-type": "off",
    "jsdoc/require-returns-type": "off",
    "jsdoc/require-throws-type": "off"
} satisfies Linter.RulesRecord;

const jsdocConfig = {
    plugins: { jsdoc },
    settings: { jsdoc: { mode: "typescript" } },
    rules: jsdocRules
};

export default tseslint.config(
    {
        ignores: ["dist/**", "coverage/**", "node_modules/**"]
    },
    {
        files: ["src/**/*.ts", "src/**/*.tsx", "tests/**/*.ts", "tests/**/*.tsx", "vitest.config.ts"],
        extends: [eslint.configs.recommended, ...tseslint.configs.strictTypeChecked],
        plugins: { "@stylistic": stylistic, ...jsdocConfig.plugins },
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname
            }
        },
        rules: {
            "@stylistic/brace-style": ["error", "1tbs", { allowSingleLine: false }],
            "@stylistic/indent": ["error", 4, { SwitchCase: 1 }],
            "@stylistic/no-trailing-spaces": "error",
            "curly": ["error", "all"]
        }
    },
    {
        ...jsdocConfig,
        files: ["src/**/*.ts", "src/**/*.tsx"]
    },
    {
        ...eslint.configs.recommended,
        ...jsdocConfig,
        files: ["eslint.config.ts", "rspack.config.ts", "scripts/**/*.ts", "vitest.config.ts"],
        plugins: { "@stylistic": stylistic, ...jsdocConfig.plugins },
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
        settings: jsdocConfig.settings,
        rules: {
            ...jsdocConfig.rules,
            "@stylistic/brace-style": ["error", "1tbs", { allowSingleLine: false }],
            "@stylistic/indent": ["error", 4, { SwitchCase: 1 }],
            "@stylistic/no-trailing-spaces": "error",
            "curly": ["error", "all"]
        }
    },
    {
        files: ["tests/**/*.ts", "tests/**/*.tsx"],
        rules: {
            "jsdoc/require-file-overview": "off",
            "jsdoc/require-jsdoc": "off",
            "jsdoc/require-description": "off",
            "jsdoc/multiline-blocks": "off",
            "jsdoc/lines-before-block": "off",
            "jsdoc/tag-lines": "off"
        }
    }
);
