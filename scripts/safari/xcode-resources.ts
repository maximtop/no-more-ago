/**
 * @file Lists the built Safari WebExtension resources for the Xcode copy phase.
 */

import {
    existsSync,
    mkdirSync,
    readdirSync,
    writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { SAFARI_OUTPUT_PATH } from './config.ts';

/**
 * Lists regular files under one generated resource directory.
 *
 * @param directory - Directory being traversed.
 * @param root - Root of the relative paths.
 *
 * @returns - Sorted POSIX-style paths relative to the root.
 *
 * @throws If the tree contains anything other than files and directories.
 */
function listFiles(directory: string, root: string): string[] {
    return readdirSync(directory, { withFileTypes: true })
        .flatMap((entry) => {
            const entryPath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                return listFiles(entryPath, root);
            }
            if (!entry.isFile()) {
                throw new Error(`Unexpected Safari resource type: ${entryPath}`);
            }
            return [path.relative(root, entryPath).split(path.sep).join('/')];
        })
        .sort();
}

/**
 * Writes the resource list and the sandbox-aware Xcode input and output file lists.
 *
 * @param webExtensionPath - Unpacked Safari WebExtension built by `pnpm dev|release safari`.
 *
 * @throws If the WebExtension has not been built.
 */
export function prepareXcodeResources(webExtensionPath: string): void {
    if (!existsSync(path.join(webExtensionPath, 'manifest.json'))) {
        throw new Error(`Missing Safari WebExtension build: ${webExtensionPath}`);
    }
    const files = listFiles(webExtensionPath, webExtensionPath);
    mkdirSync(SAFARI_OUTPUT_PATH, { recursive: true });
    writeFileSync(path.join(SAFARI_OUTPUT_PATH, 'web-extension-resources.txt'), `${files.join('\n')}\n`);
    writeFileSync(path.join(SAFARI_OUTPUT_PATH, 'web-extension-inputs.xcfilelist'), [
        '$(NO_MORE_AGO_WEB_EXTENSION_RESOURCE_LIST)',
        ...files.map((file) => `$(NO_MORE_AGO_WEB_EXTENSION_PATH)/${file}`),
        '',
    ].join('\n'));
    writeFileSync(path.join(SAFARI_OUTPUT_PATH, 'web-extension-outputs.xcfilelist'), [
        ...files.map((file) => `$(TARGET_BUILD_DIR)/$(UNLOCALIZED_RESOURCES_FOLDER_PATH)/${file}`),
        '',
    ].join('\n'));
}
