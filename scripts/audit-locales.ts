/**
 * @file Reports hardcoded user-facing copy and orphaned catalog keys.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { BASE_UI_LOCALE } from "../src/shared/i18n/locales.ts";

const ROOT = path.join(import.meta.dirname, "..");
const SCANNED_DIRECTORIES = [
    "src/popup",
    "src/options",
    "src/shared/ui",
    "src/shared/diagnostics",
];

/**
 * Literals that look like copy but are technical values the UI must not
 * translate. Keep this list short and justified; every entry is a hole in the
 * audit.
 */
const ALLOWED_LITERALS = new Set([
    "No More Ago",
    "America/New_York",
    "example.com",
    "UTC",
    "IANA",
]);

/**
 * Keys the manifest references through `__MSG_*__` rather than from source.
 */
const MANIFEST_KEYS = new Set(["extension_name", "extension_description"]);

const PROSE = /^[A-Z][A-Za-z0-9 ,.'’?%:()\u2014-]{8,}$/u;
const MULTI_WORD = / /u;
const ATTRIBUTE_NAMES = [
    "className", "data-[a-z-]+", "role", "color", "variant", "size", "gap",
    "justify", "align", "wrap", "type", "order", "component", "href", "id",
    "htmlFor", "value", "placeholder", "name", "rel", "target",
].join("|");
const ATTRIBUTE = new RegExp(`(?:${ATTRIBUTE_NAMES})=$`, "u");

/**
 * Lists every TypeScript source file under one scanned directory.
 *
 * @param directory - Repository-relative directory to walk.
 * @returns - Absolute paths of its `.ts` and `.tsx` files.
 */
function sourceFiles(directory: string): string[] {
    const root = path.join(ROOT, directory);
    return readdirSync(root)
        .filter((name) => name.endsWith(".ts") || name.endsWith(".tsx"))
        .map((name) => path.join(root, name));
}

const findings: string[] = [];

for (const directory of SCANNED_DIRECTORIES) {
    for (const file of sourceFiles(directory)) {
        const relative = path.relative(ROOT, file);
        let inBlockComment = false;
        let inImport = false;
        let inThrow = false;
        for (const [index, line] of readFileSync(file, "utf8").split("\n").entries()) {
            const trimmed = line.trim();
            if (trimmed.startsWith("/*")) {
                inBlockComment = true;
            }
            if (inBlockComment) {
                if (trimmed.includes("*/")) {
                    inBlockComment = false;
                }
                continue;
            }
            if (trimmed.startsWith("import ")) {
                inImport = !trimmed.includes(" from ") && !trimmed.endsWith(";");
                continue;
            }
            if (inImport) {
                // A multi-line import block lists type and value members that
                // read like prose but name nothing a user sees.
                if (trimmed.includes(" from ")) {
                    inImport = false;
                }
                continue;
            }
            if (/\bthrow new \w+\($/u.test(trimmed)) {
                inThrow = true;
                continue;
            }
            if (inThrow) {
                // A thrown Error's message is a developer diagnostic, not UI copy.
                if (trimmed.startsWith(")")) {
                    inThrow = false;
                }
                continue;
            }
            if (trimmed.startsWith("*") || trimmed.startsWith("//")
                || line.includes("new Error(")) {
                continue;
            }
            for (const match of line.matchAll(/"([^"\\]{9,})"/gu)) {
                const value = match[1] as string;
                const before = line.slice(0, match.index);
                if (ALLOWED_LITERALS.has(value) || !PROSE.test(value)
                    || !MULTI_WORD.test(value) || ATTRIBUTE.test(before)) {
                    continue;
                }
                findings.push(`${relative}:${String(index + 1)}: hardcoded copy "${value}"`);
            }
            if (PROSE.test(trimmed) && MULTI_WORD.test(trimmed)
                && !ALLOWED_LITERALS.has(trimmed)
                && !/[;{}=<>]$/u.test(trimmed) && !trimmed.includes("(")) {
                findings.push(`${relative}:${String(index + 1)}: hardcoded copy "${trimmed}"`);
            }
        }
    }
}

const catalog = JSON.parse(readFileSync(
    path.join(ROOT, "src/_locales", BASE_UI_LOCALE, "messages.json"),
    "utf8",
)) as Record<string, unknown>;
const sources = SCANNED_DIRECTORIES.flatMap(sourceFiles)
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
for (const key of Object.keys(catalog)) {
    if (MANIFEST_KEYS.has(key)) {
        continue;
    }
    if (!sources.includes(`"${key}"`)) {
        findings.push(`src/_locales/${BASE_UI_LOCALE}/messages.json: orphaned key ${key}`);
    }
}

if (findings.length > 0) {
    for (const finding of findings) {
        console.error(finding);
    }
    console.error(`${String(findings.length)} finding(s).`);
    process.exitCode = 1;
} else {
    console.log("No hardcoded copy or orphaned keys found.");
}
