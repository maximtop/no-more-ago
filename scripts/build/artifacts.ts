/**
 * @file Creates ZIP archives from emitted browser-extension directories.
 */

import { Buffer } from 'node:buffer';
import {
    readFileSync, readdirSync, statSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { zipSync } from 'fflate';

/**
 * Lists emitted artifact files using portable archive paths.
 *
 * @param root - Artifact directory being archived.
 * @param current - Directory currently being traversed.
 * @param output - Relative file paths collected so far.
 *
 * @returns - Sorted file paths relative to the artifact directory.
 */
function listArtifactFiles(
    root: string,
    current = root,
    output: string[] = [],
): string[] {
    for (const name of readdirSync(current)) {
        const file = path.join(current, name);
        if (statSync(file).isDirectory()) {
            listArtifactFiles(root, file, output);
        } else {
            output.push(path.relative(root, file).split(path.sep).join('/'));
        }
    }
    return output.sort();
}

/**
 * Creates a deterministic ZIP archive from one emitted extension directory.
 *
 * @param source - Emitted extension directory.
 *
 * @returns - ZIP bytes containing every emitted file.
 */
function createArtifactZip(source: string): Buffer {
    const entries: Record<string, Uint8Array> = {};
    for (const name of listArtifactFiles(source)) {
        entries[name] = new Uint8Array(readFileSync(path.join(source, ...name.split('/'))));
    }
    return Buffer.from(
        zipSync(entries, {
            level: 6,
            mtime: new Date(1980, 0, 1),
        }),
    );
}

/**
 * Writes the ZIP matching one emitted extension directory.
 *
 * @param source - Emitted extension directory.
 * @param destination - ZIP artifact path.
 */
export function writeArtifactZip(source: string, destination: string): void {
    writeFileSync(destination, createArtifactZip(source));
}
