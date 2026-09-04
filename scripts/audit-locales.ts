/**
 * @file Reports hardcoded user-facing copy and orphaned catalog keys.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { BASE_UI_LOCALE } from "../src/shared/i18n/locales.ts";

const ROOT = path.join(import.meta.dirname, "..");
const SCANNED_DIRECTORIES = [
    "src/popup",
    "src/options",
    "src/shared/ui",
    "src/shared/diagnostics",
    "src/shared/i18n",
];

/**
 * Technical values intentionally shown without translation.
 */
const ALLOWED_LITERALS = new Set([
    "No More Ago", "America/New_York", "example.com", "UTC", "IANA", "v",
]);

const MANIFEST_KEYS = new Set(["extension_name", "extension_description"]);
const COPY_ATTRIBUTES = new Set(["placeholder", "label", "title", "aria-label", "description"]);
const WORDS = /[A-Za-z]{2,}[\s·]+[A-Za-z]{2,}/u;
const findings: string[] = [];
const referencedKeys = new Set<string>();

/**
 * Lists TypeScript source files recursively beneath a directory.
 *
 * @param directory - Absolute directory to walk.
 * @returns - Absolute TypeScript and TSX source paths.
 */
function sourceFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const file = path.join(directory, entry.name);
        return entry.isDirectory() ? sourceFiles(file) : /\.tsx?$/u.test(file) ? [file] : [];
    });
}

/**
 * Finds a surrounding JSX attribute or a developer-only expression.
 *
 * @param node - Literal whose context is inspected.
 * @returns - Whether the literal is visible copy, technical data, or ordinary code.
 */
function copyContext(node: ts.Node): boolean | undefined {
    for (let parent = node.parent; parent; parent = parent.parent) {
        if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)
            || ts.isThrowStatement(parent) || ts.isNewExpression(parent)) {
            return false;
        }
        if (ts.isPropertyAssignment(parent)
            && ["fontFamily", "fontFamilyMonospace"].includes(parent.name.getText())) {
            return false;
        }
        if (ts.isJsxAttribute(parent)) {
            return COPY_ATTRIBUTES.has(parent.name.getText());
        }
        if (ts.isJsxExpression(parent) && ts.isJsxElement(parent.parent)) {
            return true;
        }
    }
    return undefined;
}

/**
 * Inspects one parsed source node, including strings, templates, and JSX text.
 *
 * @param node - Current syntax node.
 * @param source - Parsed file used for source locations.
 */
function inspect(node: ts.Node, source: ts.SourceFile): void {
    if (ts.isStringLiteralLike(node)) {
        referencedKeys.add(node.text);
    }
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node)
        || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node)) {
        const value = node.text.trim();
        const context = ts.isJsxText(node) ? true : copyContext(node);
        if (context !== false && value && !ALLOWED_LITERALS.has(value)
            && (WORDS.test(value) || (context === true && /^[A-Za-z]+$/u.test(value)))) {
            const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
            findings.push(
                `${path.relative(ROOT, source.fileName)}:${String(line)}: `
                + `hardcoded copy "${value}"`,
            );
        }
    }
    ts.forEachChild(node, (child) => inspect(child, source));
}

for (const directory of SCANNED_DIRECTORIES) {
    for (const file of sourceFiles(path.join(ROOT, directory))) {
        const source = ts.createSourceFile(
            file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true,
        );
        inspect(source, source);
    }
}

const catalog = JSON.parse(readFileSync(
    path.join(ROOT, "src/_locales", BASE_UI_LOCALE, "messages.json"), "utf8",
)) as Record<string, unknown>;
for (const key of Object.keys(catalog)) {
    if (!MANIFEST_KEYS.has(key) && !referencedKeys.has(key)) {
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
