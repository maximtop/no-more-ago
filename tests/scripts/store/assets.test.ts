/**
 * @file Verifies generated store PNGs through their decoded raster data.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { Resvg } from "@resvg/resvg-js";
import { expect, it } from "vitest";
import { renderStoreArtwork } from "../../../scripts/store/artwork.ts";
import { readStoreCatalogs } from "../../../scripts/store/catalogs.ts";
import { CAPTION_KEYS } from "../../../scripts/store/contracts.ts";
import type { StoreListing } from "../../../scripts/store/contracts.ts";

/**
 * Decodes the PNG data stream so corrupt output cannot pass a header-only check.
 *
 * @param file - Produced image.
 * @returns - Pixel dimensions after decompressing actual raster data.
 */
function decode(file: string): number[] {
    const data = readFileSync(file);
    expect(data.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const chunks: Buffer[] = [];
    for (let offset = 8; offset < data.length;) {
        const length = data.readUInt32BE(offset);
        if (data.toString("ascii", offset + 4, offset + 8) === "IDAT") {
            chunks.push(data.subarray(offset + 8, offset + 8 + length));
        }
        offset += length + 12;
    }
    expect(inflateSync(Buffer.concat(chunks)).length).toBeGreaterThan(100);
    return [data.readUInt32BE(16), data.readUInt32BE(20)];
}

it.each([1, 2] as const)("renders native pixels in the %i× image package", (pixelRatio) => {
    const root = mkdtempSync(path.join(tmpdir(), "nma-store-images-"));
    try {
        const captureWidth = 301 * pixelRatio;
        const captureHeight = 199 * pixelRatio;
        const raster = new Resvg(
            '<svg xmlns="http://www.w3.org/2000/svg"'
            + ` width="${String(captureWidth)}" height="${String(captureHeight)}">`
            + '<defs><pattern id="stripes" width="2" height="1" patternUnits="userSpaceOnUse">'
            + '<rect width="1" height="1" fill="black"/>'
            + '<rect x="1" width="1" height="1" fill="white"/></pattern></defs>'
            + `<rect width="${String(captureWidth)}" height="${String(captureHeight)}"`
            + ' fill="url(#stripes)"/></svg>',
        ).render();
        for (const key of [
            "before", "after", "format", "zone", "preview", "popup-light", "popup-dark",
        ]) {
            writeFileSync(path.join(root, `${key}.png`), raster.asPng());
        }
        writeFileSync(path.join(root, "preview.png"), new Resvg(
            '<svg xmlns="http://www.w3.org/2000/svg"'
            + ` width="${String(600 * pixelRatio)}"`
            + ` height="${String(120 * pixelRatio)}">`
            + `<rect width="${String(600 * pixelRatio)}"`
            + ` height="${String(120 * pixelRatio)}" fill="white"/></svg>`,
        ).render().asPng());
        const output = path.join(root, "output");
        renderStoreArtwork(
            readStoreCatalogs().listings.en as StoreListing, root, output, pixelRatio,
        );
        for (const key of CAPTION_KEYS) {
            const file = path.join(output, `${key}.png`);
            const width = 1280 * pixelRatio;
            const height = 800 * pixelRatio;
            expect(decode(file)).toEqual([width, height]);
            const png = readFileSync(file).toString("base64");
            const pixels = new Resvg(
                '<svg xmlns="http://www.w3.org/2000/svg"'
                + ` width="${String(width)}" height="${String(height)}">`
                + `<image href="data:image/png;base64,${png}"`
                + ` width="${String(width)}" height="${String(height)}"/>`
                + '</svg>',
                { font: { loadSystemFonts: false } },
            ).render().pixels;
            const origins = {
                replacement: [180, 318],
                control: [193, 256],
                appearance: [190, 393],
            } as const;
            const [logicalX, logicalY] = origins[key];
            const x = logicalX * pixelRatio;
            const y = logicalY * pixelRatio;
            const region = Buffer.concat(Array.from({ length: captureHeight }, (_, row) => {
                const start = ((y + row) * width + x) * 4;
                return pixels.subarray(start, start + captureWidth * 4);
            }));
            expect(region).toEqual(raster.pixels);
        }
        if (pixelRatio === 1) {
            expect(decode(path.join(output, "promo.png"))).toEqual([440, 280]);
            expect(decode(path.join(output, "icon.png"))).toEqual([128, 128]);
        }
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}, 15_000);
