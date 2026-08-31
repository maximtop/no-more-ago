/**
 * @file Verifies reversible compound in-place timestamp presentation.
 */

import { describe, expect, it } from "vitest";

import {
    ADJACENT_TIME_PRESENTATION,
    TIMESTAMP_PRESENTATION_KIND,
} from "../../../../src/content-script/adapters/types";
import {
    readPageOwnedText,
    renderTimestampPresentation,
    restoreTimestampPresentation,
} from "../../../../src/content-script/transformation/render-timestamp-presentation";

describe("compound timestamp presentation", () => {
    it("changes only the delimited timestamp text and restores the original", () => {
        const source = document.createElement("p");
        const link = document.createElement("a");
        link.href = "/visibility";
        link.textContent = "Connections";
        const target = document.createTextNode(" 1w • Edited • ");
        source.append(target, link);
        const attributes = source.getAttributeNames();

        const result = renderTimestampPresentation(
            source,
            null,
            {
                kind: TIMESTAMP_PRESENTATION_KIND.IN_PLACE_TEXT,
                target,
                textPrefix: " ",
                textSuffix: " • Edited • ",
            },
            "Jan 2, 2024",
        );

        expect(result?.output).toBe(target);
        expect(target.data).toBe(" Jan 2, 2024 • Edited • ");
        expect(source.lastChild).toBe(link);
        expect(link.href).toContain("/visibility");
        expect(source.getAttributeNames()).toEqual(attributes);
        expect(readPageOwnedText(target)).toBe(" 1w • Edited • ");

        restoreTimestampPresentation(source);

        expect(target.data).toBe(" 1w • Edited • ");
        expect(source.firstChild).toBe(target);
        expect(source.lastChild).toBe(link);
    });

    it("retains a later page-authored baseline across re-render and restore", () => {
        const source = document.createElement("p");
        const target = document.createTextNode("1w •");
        source.append(target);
        const presentation = {
            kind: TIMESTAMP_PRESENTATION_KIND.IN_PLACE_TEXT,
            target,
            textSuffix: " •",
        } as const;

        renderTimestampPresentation(source, null, presentation, "Jan 2, 2024");
        target.data = "2w • Edited";
        renderTimestampPresentation(
            source,
            null,
            { ...presentation, textSuffix: " • Edited" },
            "Jan 9, 2024",
        );

        expect(readPageOwnedText(target)).toBe("2w • Edited");
        restoreTimestampPresentation(source);
        expect(target.data).toBe("2w • Edited");
    });

    it("rejects a missing datetime only for adjacent presentation", () => {
        const source = document.createElement("time");

        expect(
            renderTimestampPresentation(
                source,
                null,
                ADJACENT_TIME_PRESENTATION,
                "Jan 2, 2024",
            ),
        ).toBeNull();
    });
});
