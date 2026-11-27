/**
 * @file Renders the toolbar icon PNGs and the macOS app icon set from the SVG master.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Resvg } from '@resvg/resvg-js';

import { EXTENSION_ICON_BASENAME, EXTENSION_ICON_SIZES } from '../src/shared/extension-files.ts';

const workspaceRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const iconsDirectory = path.join(workspaceRoot, 'src/assets/icons');
const appIconDirectory = path.join(
    workspaceRoot,
    'safari/macos/No More Ago/No More Ago/Assets.xcassets/AppIcon.appiconset',
);
const master = readFileSync(path.join(iconsDirectory, `${EXTENSION_ICON_BASENAME}.svg`), 'utf8');

/**
 * Point sizes of the macOS app icon set; each is rendered at 1x and 2x.
 */
const APP_ICON_POINT_SIZES = [16, 32, 128, 256, 512] as const;

/**
 * The mark on a white rounded plate inside the 1024-unit macOS icon grid, following Apple's
 * 824-unit plate with 100-unit margins.
 */
const appIcon = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">',
    '<rect x="100" y="100" width="824" height="824" rx="185" fill="#fff"/>',
    master.replace('<svg ', '<svg x="232" y="232" width="560" height="560" '),
    '</svg>',
].join('');

/**
 * Renders one SVG document to a square PNG file and reports its path.
 *
 * @param svg - SVG document to render.
 * @param size - Output width and height in pixels.
 * @param file - Destination PNG path.
 */
function renderPng(svg: string, size: number, file: string): void {
    writeFileSync(file, new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng());
    process.stdout.write(`${file}\n`);
}

for (const size of EXTENSION_ICON_SIZES) {
    renderPng(master, size, path.join(iconsDirectory, `${EXTENSION_ICON_BASENAME}-${String(size)}.png`));
}
for (const size of APP_ICON_POINT_SIZES) {
    renderPng(appIcon, size, path.join(appIconDirectory, `AppIcon-${String(size)}.png`));
    renderPng(appIcon, size * 2, path.join(appIconDirectory, `AppIcon-${String(size)}@2x.png`));
}
