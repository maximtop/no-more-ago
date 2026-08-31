/**
 * @file Neutral content-script diagnostic contracts shared by processing participants.
 */

import type { DiagnosticEventInput } from "../shared/diagnostics/events";

/**
 * Receives bounded processing facts after page-derived data has been sanitized.
 */
export type DocumentDiagnosticSink = (event: DiagnosticEventInput) => void;
