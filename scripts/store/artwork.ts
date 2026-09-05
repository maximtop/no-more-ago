/**
 * @file Composes English store artwork from actual captures and maintained captions.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { CAPTION_KEYS } from "./contracts.ts";
import type { StoreListing } from "./contracts.ts";
import { STORE_ROOT } from "./catalogs.ts";

/**
 * Escapes caption text for SVG text nodes.
 *
 * @param text - Maintained English text.
 * @returns - XML-safe text.
 */
function escapeXml(text: string): string {
    return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

/**
 * Embeds a local image without external image requests.
 *
 * @param file - Capture or icon path.
 * @returns - PNG data URI.
 */
function imageData(file: string): string {
    return `data:image/png;base64,${readFileSync(file).toString("base64")}`;
}

/**
 * Rasterizes one owned SVG composition.
 *
 * @param output - Destination path.
 * @param svg - Complete artwork source.
 */
function writePng(output: string, svg: string): void {
    writeFileSync(output, new Resvg(svg, {
        font: { loadSystemFonts: true, defaultFontFamily: "Arial" },
    }).render().asPng());
}

/**
 * Places an owned PNG at its native pixel size, centered on integer coordinates.
 *
 * @param file - Raw browser capture.
 * @param left - Left edge of the available rectangle in layout units.
 * @param top - Top edge of the available rectangle in layout units.
 * @param width - Available width in layout units.
 * @param height - Available height in layout units.
 * @param alignTop - Whether a detail crop aligns with the top of its card.
 * @returns - SVG image without raster scaling.
 */
function capturePanel(
    file: string,
    left: number,
    top: number,
    width: number,
    height: number,
    alignTop = false,
): string {
    const png = readFileSync(file);
    const captureWidth = png.readUInt32BE(16);
    const captureHeight = png.readUInt32BE(20);
    if (captureWidth > width || captureHeight > height) {
        const bounds = `${width}×${height}`;
        throw new Error(
            `${file} does not fit at native pixel size; recapture within ${bounds}.`,
        );
    }
    const x = left + Math.floor((width - captureWidth) / 2);
    const y = top + (alignTop ? 0 : Math.floor((height - captureHeight) / 2));
    return `<image href="data:image/png;base64,${png.toString("base64")}" x="${x}" y="${y}"
        width="${captureWidth}" height="${captureHeight}"/>`;
}

/**
 * Composes raw captures directly into the final screenshot without intermediate PNGs.
 *
 * @param key - Screenshot role.
 * @param captures - Raw browser capture directory.
 * @returns - Native-size capture content in the screenshot's inner rectangle.
 */
function screenshotContent(
    key: (typeof CAPTION_KEYS)[number],
    captures: string,
): string {
    if (key === "control") {
        const format = capturePanel(
            path.join(captures, "format.png"), 84, 256, 519, 251, true,
        );
        const zone = capturePanel(
            path.join(captures, "zone.png"), 678, 256, 519, 251, true,
        );
        const preview = capturePanel(
            path.join(captures, "preview.png"), 125, 590, 1031, 149,
        );
        return `<rect x="64" y="236" width="558" height="292" rx="16"
                fill="#f6f9fc" stroke="#d6e0da" filter="url(#card-shadow)"/>
            <rect x="658" y="236" width="558" height="292" rx="16"
                fill="#f6f9fc" stroke="#d6e0da" filter="url(#card-shadow)"/>
            <rect x="105" y="570" width="1070" height="189" rx="16"
                fill="#f6f9fc" stroke="#d6e0da" filter="url(#card-shadow)"/>
            ${format}${zone}${preview}`;
    }
    if (key === "replacement") {
        const before = capturePanel(
            path.join(captures, "before.png"), 96, 298, 470, 239,
        );
        const after = capturePanel(
            path.join(captures, "after.png"), 714, 410, 470, 239,
        );
        return `<text x="72" y="253" fill="#b8cabc" font-size="22"
                font-weight="700">Before</text>
            <text x="690" y="365" fill="#8cdf79" font-size="22"
                font-weight="700">After</text>
            <rect x="72" y="274" width="518" height="287" rx="16"
                fill="#ffffff" stroke="#91a298" filter="url(#card-shadow)"/>
            <rect x="690" y="386" width="518" height="287" rx="16"
                fill="#ffffff" stroke="#79c96b" stroke-width="1.5"
                filter="url(#card-shadow)"/>
            ${before}${after}
            <path d="M 610 430 L 668 462" fill="none" stroke="#8cdf79"
                stroke-width="2" stroke-linecap="round"/>
            <path d="M 655 462 L 668 462 L 662 450" fill="none"
                stroke="#8cdf79" stroke-width="2" stroke-linecap="round"
                stroke-linejoin="round"/>`;
    }
    const light = capturePanel(
        path.join(captures, "popup-light.png"), 118, 232, 445, 522,
    );
    const dark = capturePanel(
        path.join(captures, "popup-dark.png"), 718, 232, 445, 522,
    );
    return `<text x="110" y="207" fill="#d9e6dc" font-size="22"
            font-weight="700">Light</text>
        <text x="710" y="207" fill="#d9e6dc" font-size="22"
            font-weight="700">Dark</text>
        <rect x="110" y="224" width="460" height="538" rx="16"
            fill="#f6f9fc" stroke="#9bad9f" filter="url(#card-shadow)"/>
        <rect x="710" y="224" width="460" height="538" rx="16"
            fill="#14191e" stroke="#79c96b" stroke-opacity="0.45"
            filter="url(#card-shadow)"/>
        ${light}${dark}`;
}

/**
 * Rebuilds screenshots and promo art from maintained inputs.
 *
 * @param listing - English source catalog.
 * @param captures - Directory containing the seven raw browser captures.
 * @param output - Output image directory.
 */
export function renderStoreArtwork(
    listing: StoreListing,
    captures: string,
    output: string,
): void {
    if (listing.locale !== "en") {
        throw new Error("Store artwork currently supports English only.");
    }
    // Load all captures before writing so missing inputs cannot yield a partial package.
    const screenshots = CAPTION_KEYS.map((key) => screenshotContent(key, captures));
    const iconPath = path.join(STORE_ROOT, "src/assets/icons/icon-128.png");
    const icon = imageData(iconPath);
    mkdirSync(output, { recursive: true });
    CAPTION_KEYS.forEach((key, index) => {
        const { heading, body } = listing.captions[key];
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800">
            <defs>
                <radialGradient id="background" cx="56%" cy="76%" r="82%">
                    <stop offset="0" stop-color="#153b28"/>
                    <stop offset="0.52" stop-color="#0b271b"/>
                    <stop offset="1" stop-color="#061712"/>
                </radialGradient>
                <filter id="card-shadow" x="-20%" y="-20%" width="140%" height="160%">
                    <feDropShadow dx="0" dy="12" stdDeviation="16"
                        flood-color="#000000" flood-opacity="0.34"/>
                </filter>
            </defs>
            <rect width="1280" height="800" fill="url(#background)"/>
            <image href="${icon}" x="64" y="27" width="28" height="28"/>
            <text x="105" y="50" fill="#d9e6dc" font-family="Arial"
                font-size="22" font-weight="600">No More Ago</text>
            <text x="64" y="122" fill="#f7f8f2" font-family="Arial"
                font-size="64" font-weight="700" letter-spacing="-1.2"
                >${escapeXml(heading)}</text>
            <text x="66" y="170" fill="#b8cabc" font-family="Arial"
                font-size="23">${escapeXml(body)}</text>
            ${screenshots[index]}
        </svg>`;
        writePng(path.join(output, `${key}.png`), svg);
    });
    renderStoreBrandArtwork(output);
}

/**
 * Produces the icon and global promotional tile without requiring browser captures.
 *
 * @param output - Output image directory.
 */
export function renderStoreBrandArtwork(output: string): void {
    mkdirSync(output, { recursive: true });
    const iconPath = path.join(STORE_ROOT, "src/assets/icons/icon-128.png");
    const icon = imageData(iconPath);
    const mark = readFileSync(path.join(STORE_ROOT, "src/assets/icons/icon.svg"), "utf8");
    const accent = mark.match(/fill="(rgb\([^)]+\))"/u)![1]!;
    writePng(path.join(output, "promo.png"),
        `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="280">
            <rect width="440" height="280" fill="#f7faf8"/>
            <rect width="440" height="8" fill="${accent}"/>
            <circle cx="220" cy="106" r="71" fill="#e6eee8"/>
            <image href="${icon}" x="178" y="64" width="84" height="84"/>
            <text x="220" y="223" text-anchor="middle" fill="#182b21"
                font-family="Georgia" font-size="44">No More Ago</text>
        </svg>`);
    copyFileSync(iconPath, path.join(output, "icon.png"));
}
