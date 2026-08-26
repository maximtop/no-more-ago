import { readFileSync } from "node:fs";
import path from "node:path";
import { sources, Compilation } from "@rspack/core";

export const BROWSERS = ["chrome", "firefox", "edge"];
export const MODES = ["dev", "release"];

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function metadataPlugin({ workspaceRoot, browser }) {
  const commonPath = path.join(workspaceRoot, "src/manifest/common.json");
  const variantPath = path.join(workspaceRoot, `src/manifest/${browser}.json`);
  const packagePath = path.join(workspaceRoot, "package.json");
  const iconPaths = [16, 32, 48, 128].map((size) =>
    path.join(workspaceRoot, `src/assets/icons/clock-${size}.png`)
  );
  const popupHtmlPath = path.join(workspaceRoot, "src/popup/popup.html");
  const optionsHtmlPath = path.join(workspaceRoot, "src/options/options.html");
  return {
    apply(compiler) {
      compiler.hooks.thisCompilation.tap("NoMoreAgoMetadata", (compilation) => {
        for (const file of [packagePath, commonPath, variantPath, popupHtmlPath, optionsHtmlPath, ...iconPaths]) compilation.fileDependencies.add(file);
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

export function createRspackConfig({ workspaceRoot, browser, mode, outputPath }) {
  if (!BROWSERS.includes(browser) || !MODES.includes(mode)) throw new Error("Invalid browser or mode");
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
