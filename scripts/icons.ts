/**
 * @file Renders the toolbar icon PNGs from the SVG master at every declared size.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Resvg } from '@resvg/resvg-js';

import { EXTENSION_ICON_BASENAME, EXTENSION_ICON_SIZES } from '../src/shared/extension-files.ts';

const iconsDirectory = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'src/assets/icons',
);
const master = readFileSync(path.join(iconsDirectory, `${EXTENSION_ICON_BASENAME}.svg`), 'utf8');

for (const size of EXTENSION_ICON_SIZES) {
    const rendered = new Resvg(master, { fitTo: { mode: 'width', value: size } }).render();
    const file = path.join(iconsDirectory, `${EXTENSION_ICON_BASENAME}-${String(size)}.png`);
    writeFileSync(file, rendered.asPng());
    process.stdout.write(`${file}\n`);
}
