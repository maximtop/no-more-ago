/**
 * @file Safe filesystem, archive, and artifact validation services for extension builds.
 */

import { Buffer } from "node:buffer";
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { unzipSync as fflateUnzipSync, unzlibSync, zipSync as fflateZipSync } from "fflate";

/**
 * Browser variants emitted by the artifact build.
 */
export const SUPPORTED_BROWSERS: string[] = ["chrome", "firefox", "edge"];

/**
 * Minimal manifest fields checked before an emitted browser artifact is accepted.
 */
type ArtifactManifest = Record<string, any>;

/**
 * Matching unpacked directory and ZIP bytes produced for one browser target.
 */
type ArtifactPair = { directory: string; zipBytes: Buffer };

/**
 * Per-browser artifact results, allowing a requested target to be selected after compilation.
 */
type PairMap = Record<string, ArtifactPair | undefined>;

/**
 * Injectable ZIP encoder signature used for production packaging and failure tests.
 */
type ZipImplementation = (entries: any, options?: any) => Uint8Array;

/**
 * Optional filesystem seams used to exercise guarded artifact publication failures.
 */
type FileSystemOverrides = {
    existsSync?: (path: string) => boolean;
    renameSync?: (from: string, to: string) => void;
    rmSync?: (path: string, options?: { recursive?: boolean; force?: boolean }) => void;
};

/**
 * Dependency overrides for filesystem and archive operations in the build pipeline.
 */
type ArtifactServicesOptions = {
    fs?: FileSystemOverrides;
    zip?: ZipImplementation;
    zipSync?: ZipImplementation;
    unzipSync?: (data: Uint8Array) => Record<string, Uint8Array>;
};

/**
 * Compares normalized paths to prevent a build artifact from escaping its approved root.
 */
function inside(root: string, candidate: string): boolean {
    const rel = path.relative(root, candidate);
    return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/**
 * Rejects missing, symlinked, or escaping paths before filesystem access.
 */
function assertSafe(root: string, candidate: string, { allowMissing = false }: { allowMissing?: boolean } = {}): string {
    const absoluteRoot = path.resolve(root);
    const absolute = path.resolve(candidate);
    if (!inside(absoluteRoot, absolute)) throw new Error(`Path escapes guarded root: ${absolute}`);
    let current = absoluteRoot;
    const rel = path.relative(absoluteRoot, absolute);
    for (const part of rel ? rel.split(path.sep) : []) {
        current = path.join(current, part);
        if (!existsSync(current)) {
            if (allowMissing) break;
            throw new Error(`Missing guarded path: ${current}`);
        }
        const stat = lstatSync(current);
        if (stat.isSymbolicLink()) throw new Error(`Symlink is not allowed: ${current}`);
    }
    if (existsSync(absolute)) {
        const stat = lstatSync(absolute);
        if (stat.isSymbolicLink()) throw new Error(`Symlink is not allowed: ${absolute}`);
        const canonicalRoot = realpathSync(absoluteRoot);
        const canonical = realpathSync(absolute);
        if (!inside(canonicalRoot, canonical)) throw new Error(`Real path escapes guarded root: ${absolute}`);
    }
    return absolute;
}

/**
 * Creates a guarded output directory and verifies its final path.
 */
function ensureDir(dir: string): void {
    assertSafe(path.dirname(dir), dir, { allowMissing: true });
    mkdirSync(dir, { recursive: true });
    assertSafe(path.dirname(dir), dir);
}

import { readdirSync } from "node:fs";

/**
 * Lists regular files beneath an artifact root using portable paths.
 */
function listFiles(root: string, current = root, output: string[] = []): string[] {
    assertSafe(root, current);
    for (const name of readdirSync(current)) {
        const file = path.join(current, name);
        const stat = lstatSync(file);
        assertSafe(root, file);
        if (stat.isDirectory()) listFiles(root, file, output);
        else if (stat.isFile()) output.push(path.relative(root, file).split(path.sep).join("/"));
        else throw new Error(`Unsupported artifact entry: ${file}`);
    }
    return output.sort();
}

/**
 * Recursively copies only regular files, rejecting symlinks and special entries along the way.
 */
function copyTree(source: string, destination: string): void {
    assertSafe(path.dirname(source), source);
    ensureDir(destination);
    for (const name of readdirSync(source)) {
        const from = path.join(source, name);
        const to = path.join(destination, name);
        const stat = lstatSync(from);
        if (stat.isSymbolicLink()) throw new Error(`Symlink is not allowed: ${from}`);
        if (stat.isDirectory()) copyTree(from, to);
        else if (stat.isFile()) { assertSafe(destination, to, { allowMissing: true }); copyFileSync(from, to); }
        else throw new Error(`Unsupported artifact entry: ${from}`);
    }
}

/**
 * Calculates the CRC-32 checksum stored in a PNG chunk.
 */
function pngCrc32(buffer: Uint8Array): number {
    let crc = ~0;
    for (const byte of buffer) { crc ^= byte; for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    return (~crc) >>> 0;
}

/**
 * Verifies PNG signature, chunk order, CRCs, RGBA dimensions, decompression, and filter bytes.
 */
function validatePng(file: string, expectedSize: number): void {
    const bytes = readFileSync(file);
    if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) || bytes.toString("ascii", 12, 16) !== "IHDR") throw new Error(`Invalid PNG: ${file}`);
    let offset = 8; let sawHeader = false; let sawEnd = false; let sawData = false; const imageData = [];
    while (offset < bytes.length) {
        if (offset + 12 > bytes.length) throw new Error(`Truncated PNG chunk: ${file}`);
        const length = bytes.readUInt32BE(offset); const type = bytes.subarray(offset + 4, offset + 8).toString("ascii"); const end = offset + 12 + length;
        if (end > bytes.length) throw new Error(`Truncated PNG data: ${file}`);
        const data = bytes.subarray(offset + 8, offset + 8 + length); const expectedCrc = bytes.readUInt32BE(offset + 8 + length); if (pngCrc32(Buffer.concat([Buffer.from(type), data])) !== expectedCrc) throw new Error(`PNG CRC mismatch: ${file}`);
        if (!sawHeader && type !== "IHDR") throw new Error(`PNG IHDR is not first: ${file}`);
        if (type === "IHDR") {
            if (sawHeader || length !== 13 || data.readUInt32BE(0) !== expectedSize || data.readUInt32BE(4) !== expectedSize || data[8] !== 8 || data[9] !== 6 || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) throw new Error(`Unexpected PNG dimensions or format: ${file}`);
            sawHeader = true;
        }
        if (type === "IDAT") { sawData = true; imageData.push(data); }
        if (type === "IEND") { if (length !== 0 || sawEnd || end !== bytes.length) throw new Error(`Invalid PNG IEND: ${file}`); sawEnd = true; }
        offset = end;
    }
    if (!sawHeader || !sawData || !sawEnd) throw new Error(`PNG is incomplete: ${file}`);
    let decoded;
    try { decoded = Buffer.from(unzlibSync(new Uint8Array(Buffer.concat(imageData)))); } catch (error) { throw new Error(`Invalid PNG image data: ${file}`, { cause: error }); }
    const rowBytes = expectedSize * 4;
    if (decoded.length !== expectedSize * (rowBytes + 1)) throw new Error(`Invalid PNG scanline data: ${file}`);
    for (let row = 0; row < expectedSize; row += 1) if ((decoded[row * (rowBytes + 1)] ?? 5) > 4) throw new Error(`Invalid PNG filter byte: ${file}`);
}

/**
 * Verifies directory and ZIP contents agree, manifest references resolve, and emitted scripts parse.
 */
function validatePair(directory: string, zipBytes: Buffer, decoder: (data: Uint8Array) => Record<string, Uint8Array> = fflateUnzipSync): { files: string[]; manifest: ArtifactManifest; zipBytes: Buffer } {
    const files = listFiles(directory);
    if (!files.includes("manifest.json")) throw new Error("Artifact has no manifest.json");
    const manifest = JSON.parse(readFileSync(path.join(directory, "manifest.json"), "utf8")) as ArtifactManifest;
    if (manifest.manifest_version !== 3 || typeof manifest.version !== "string") throw new Error("Invalid emitted manifest");
    if (manifest.background?.service_worker !== "background.js" && !Array.isArray(manifest.background?.scripts)) throw new Error("Invalid background definition");
    const references = ["background.js", "content.js", ...(manifest.background?.scripts ?? [])];
    for (const iconSize of [16, 32, 48, 128]) { const icon = manifest.icons?.[String(iconSize)]; if (icon !== `icons/clock-${iconSize}.png`) throw new Error("Manifest icon references are invalid"); validatePng(path.join(directory, icon), iconSize); references.push(icon); }
    for (const reference of references) { if (!files.includes(reference)) throw new Error(`Manifest references missing file: ${reference}`); if (reference.endsWith(".js")) new vm.Script(readFileSync(path.join(directory, reference), "utf8")); }
    const documents = [
        ["popup", manifest.action?.default_popup],
        ["options", manifest.options_ui?.page]
    ];
    if (manifest.options_ui !== undefined && (typeof manifest.options_ui !== "object" || manifest.options_ui === null || manifest.options_ui.open_in_tab !== true)) {
        throw new Error("Invalid options page metadata");
    }
    for (const [label, document] of documents) {
        if (document === undefined) continue;
        if (typeof document !== "string" || !document || document.startsWith("/")) throw new Error(`Invalid ${label} reference`);
        if (!files.includes(document)) throw new Error(`Manifest references missing file: ${document}`);
        const html = readFileSync(path.join(directory, document), "utf8");
        if (/<script\b(?![^>]*\bsrc\s*=)[^>]*>/i.test(html) || /<style\b/i.test(html) || /\son[a-z]+\s*=/i.test(html)) throw new Error(`${label} contains inline executable markup`);
        const scriptReferences = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)].map((match) => match[1]).filter((reference): reference is string => reference !== undefined);
        const styleReferences = [...html.matchAll(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi)].map((match) => match[1]).filter((reference): reference is string => reference !== undefined);
        for (const reference of [...scriptReferences, ...styleReferences]) {
            if (!reference || /^(?:[a-z]+:|\/\/|data:|blob:|javascript:)/i.test(reference) || reference.startsWith("/")) throw new Error(`${label} contains a remote or executable reference`);
            if (!files.includes(reference)) throw new Error(`${label} references missing file: ${reference}`);
        }
        for (const reference of scriptReferences) new vm.Script(readFileSync(path.join(directory, reference), "utf8"));
    }
    let archive;
    try { archive = decoder(new Uint8Array(zipBytes)); } catch (error) { throw new Error(`Invalid ZIP archive: ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
    const archiveNames = Object.keys(archive).sort(); if (archiveNames.join("\0") !== files.join("\0")) throw new Error("ZIP names differ from unpacked inventory");
    for (const name of files) {
        const archived = archive[name];
        if (!archived || !Buffer.from(archived).equals(readFileSync(path.join(directory, ...name.split("/"))))) throw new Error(`ZIP bytes differ for ${name}`);
    }
    return { files, manifest, zipBytes };
}

/**
 * Produces deterministic ZIP entries from a validated artifact directory.
 */
function zipEntries(root: string): Record<string, Uint8Array> {
    const entries: Record<string, Uint8Array> = {};
    for (const name of listFiles(root)) entries[name] = new Uint8Array(readFileSync(path.join(root, ...name.split("/"))));
    return entries;
}

/**
 * Returns guarded snapshot, archive, validation, and atomic publication operations for build tasks.
 */
export function createArtifactServices({ fs, zip, zipSync: injectedZipSync, unzipSync }: ArtifactServicesOptions = {}) {
    // The public boundary is intentionally injectable; production uses pinned fflate.
    void fs;
    const pack = zip ?? injectedZipSync ?? fflateZipSync;
    const io = {
        existsSync: fs?.existsSync?.bind(fs) ?? existsSync,
        renameSync: fs?.renameSync?.bind(fs) ?? renameSync,
        rmSync: fs?.rmSync?.bind(fs) ?? rmSync
    };
    return {
        listFiles,
        snapshot(source: string, destination: string) { copyTree(source, destination); return listFiles(destination); },
        createZip(source: string) {
            const entries = zipEntries(source);
            const options = { level: 0 as const, mtime: new Date(1980, 0, 1, 0, 0, 0, 0) };
            return Buffer.from(pack(entries, options));
        },
        validatePair(directory: string, zipBytes: Buffer) { return validatePair(directory, zipBytes, unzipSync ?? fflateUnzipSync); },
        buildCandidateModeRoot({ workspaceRoot, mode, pairs, selected }: { workspaceRoot: string; mode: string; pairs: PairMap; selected?: string }) {
            const distRoot = path.join(workspaceRoot, "dist"); const modeRoot = path.join(distRoot, mode); const candidate = mkdtempSync(path.join(distRoot, `.candidate-${mode}-`));
            try {
                for (const browser of SUPPORTED_BROWSERS) {
                    if (browser === selected || pairs[browser]) {
                        const pair = pairs[browser]; if (!pair) continue;
                        copyTree(pair.directory, path.join(candidate, browser)); writeFileSync(path.join(candidate, `${browser}.zip`), pair.zipBytes);
                    } else if (io.existsSync(path.join(modeRoot, browser))) {
                        copyTree(path.join(modeRoot, browser), path.join(candidate, browser));
                        if (io.existsSync(path.join(modeRoot, `${browser}.zip`))) copyFileSync(path.join(modeRoot, `${browser}.zip`), path.join(candidate, `${browser}.zip`));
                    }
                }
            } catch (error) { rmSync(candidate, { recursive: true, force: true }); throw error; }
            return { candidate, modeRoot };
        },
        publishModeRoot({ candidate, modeRoot, taskRoot }: { candidate: string; modeRoot: string; taskRoot: string }) {
            assertSafe(path.dirname(modeRoot), modeRoot, { allowMissing: true }); assertSafe(path.dirname(candidate), candidate);
            ensureDir(path.dirname(modeRoot));
            let backup = null;
            if (io.existsSync(modeRoot)) { backup = path.join(taskRoot, `previous-${path.basename(modeRoot)}`); assertSafe(taskRoot, backup, { allowMissing: true }); io.renameSync(modeRoot, backup); }
            try { io.renameSync(candidate, modeRoot); }
            catch (error) {
                if (backup) { try { io.renameSync(backup, modeRoot); } catch (restoreError) { const failure = new Error(`Publication failed; recovery: rename ${backup} -> ${modeRoot}; ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`, { cause: restoreError }) as Error & { keepTask?: boolean }; failure.keepTask = true; throw failure; } }
                throw error;
            }
            if (backup) { try { io.rmSync(backup, { recursive: true, force: false }); } catch (error) { const failure = new Error(`Published successfully; remove backup ${backup}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }) as Error & { keepTask?: boolean }; failure.keepTask = true; throw failure; } }
        },
        cleanupCandidate(candidate: string) { assertSafe(path.dirname(candidate), candidate); if (existsSync(candidate)) rmSync(candidate, { recursive: true, force: false }); },
        cleanupTask(taskRoot: string) { assertSafe(path.dirname(taskRoot), taskRoot); if (existsSync(taskRoot)) rmSync(taskRoot, { recursive: true, force: false }); }
    };
}

export { assertSafe, listFiles };
