/**
 * @file Rspack configuration that assembles browser-specific extension artifacts.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { sources, Compilation } from "@rspack/core";

/**
 * Browser targets for which the extension manifest and bundles are emitted.
 */
export const BROWSERS = ["chrome", "firefox", "edge"];

/**
 * Build modes controlling source maps and release-oriented output.
 */
export const MODES = ["dev", "release"];

/**
 * Loads a trusted build-time JSON file and returns its object representation.
 *
 * @param file - Path to the trusted JSON file.
 * @returns - Parsed JSON object.
 */
function readJson(file: string): Record<string, any> {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, any>;
}

/**
 * Adds manifests, HTML entry points, and extension icons to each Rspack compilation.
 *
 * @param options - Metadata plugin inputs.
 * @param options.workspaceRoot - Absolute project workspace path.
 * @param options.browser - Browser whose manifest variant is being built.
 * @returns - Rspack plugin that emits the extension metadata assets.
 */
function metadataPlugin({ workspaceRoot, browser }: { workspaceRoot: string; browser: string }) {
    const commonPath = path.join(workspaceRoot, "src/manifest/common.json");
    const variantPath = path.join(workspaceRoot, `src/manifest/${browser}.json`);
    const packagePath = path.join(workspaceRoot, "package.json");
    const iconPaths = [16, 32, 48, 128].map((size) =>
        path.join(workspaceRoot, `src/assets/icons/clock-${size}.png`)
    );
    const popupHtmlPath = path.join(workspaceRoot, "src/popup/popup.html");
    const optionsHtmlPath = path.join(workspaceRoot, "src/options/options.html");
    return {
        apply(compiler: any): void {
            compiler.hooks.thisCompilation.tap("NoMoreAgoMetadata", (compilation: any) => {
                for (const file of [packagePath, commonPath, variantPath, popupHtmlPath, optionsHtmlPath, ...iconPaths]) {
                    compilation.fileDependencies.add(file);
                }
                compilation.hooks.processAssets.tap(
                    { name: "NoMoreAgoMetadata", stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS },
                    () => {
                        const manifest = {
                            ...readJson(commonPath),
                            ...readJson(variantPath),
                            version: readJson(packagePath).version
                        };
                        compilation.emitAsset("manifest.json", new sources.RawSource(`${JSON.stringify(manifest, null, 2)}\n`));
                        compilation.emitAsset("popup.html", new sources.RawSource(readFileSync(popupHtmlPath)));
                        compilation.emitAsset("options.html", new sources.RawSource(readFileSync(optionsHtmlPath)));
                        for (const size of [16, 32, 48, 128]) {
                            const file = path.join(workspaceRoot, `src/assets/icons/clock-${size}.png`);
                            compilation.emitAsset(`icons/clock-${size}.png`, new sources.RawSource(readFileSync(file)));
                        }
                    }
                );
            });
        }
    };
}

/**
 * Produces a browser- and mode-specific Rspack configuration after validating requested inputs.
 *
 * @param options - Validated build configuration inputs.
 * @param options.workspaceRoot - Absolute project workspace path.
 * @param options.browser - Browser target to build.
 * @param options.mode - Development or release build mode.
 * @param options.outputPath - Directory where Rspack emits the build.
 * @returns - Rspack configuration for the requested browser and mode.
 */
export function createRspackConfig({ workspaceRoot, browser, mode, outputPath }: { workspaceRoot: string; browser: string; mode: string; outputPath: string }): Record<string, any> {
    if (!BROWSERS.includes(browser) || !MODES.includes(mode)) {
        throw new Error("Invalid browser or mode");
    }
    return {
        context: workspaceRoot,
        target: "web",
        entry: { background: "./src/background/chrome.ts", content: "./src/content/main.ts", popup: "./src/popup/main.tsx", options: "./src/options/main.tsx" },
        output: { path: outputPath, filename: "[name].js", clean: true },
        devtool: mode === "dev" ? "source-map" : false,
        resolve: { extensions: [".tsx", ".ts", ".js", ".mjs", ".json"] },
        module: {
            rules: [
                { test: /\.tsx?$/, exclude: /node_modules/, type: "javascript/auto", use: [{
                    loader: "builtin:swc-loader",
                    options: { jsc: { parser: { syntax: "typescript", tsx: true }, target: "es2022", transform: { react: { runtime: "automatic" } } }, module: { type: "es6" } }
                }] },
                { test: /\.css$/, type: "css" }
            ]
        },
        experiments: { css: true },
        plugins: [metadataPlugin({ workspaceRoot, browser })]
    };
}

export default createRspackConfig;
