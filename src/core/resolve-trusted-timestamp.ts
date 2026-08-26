import { isValid, parseISO } from "date-fns";

import {
  EXPLICIT_ZONED_DATETIME_RULE,
  type TimestampCandidate
} from "../adapters/types";

const ZONE = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/;
const YEAR = "(?:\\d{4}|[+-]\\d{6})";
const DATE = `(?:${YEAR}-(?:\\d{2}-\\d{2}|\\d{3}|W\\d{2}-\\d)|${YEAR}(?:\\d{4}|\\d{3}|W\\d{3}))`;
const FRACTION = "(?:[.,]\\d+)";
const TIME = `(?:\\d{2}:\\d{2}(?:${FRACTION}|:\\d{2}(?:${FRACTION})?)?|\\d{4}(?:${FRACTION}|\\d{2}(?:${FRACTION})?)?)`;
const COMPLETE_DATE_TIME = new RegExp(`^${DATE}[T ]${TIME}$`);

function hasKnownNumericZone(zone: string): boolean {
  if (zone === "Z") return true;
  const sign = zone[0];
  const digits = zone.slice(1).replace(":", "");
  const hours = Number(digits.slice(0, 2));
  const minutes = digits.length === 4 ? Number(digits.slice(2)) : 0;
  if (hours > 23 || minutes > 59) return false;
  return !(sign === "-" && hours === 0 && minutes === 0);
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if ((code >= 0 && code <= 31) || (code >= 127 && code <= 159)) return true;
  }
  return false;
}

export interface ResolvedTimestamp {
  readonly source: Element;
  readonly sourceDatetime: string;
  readonly instant: Date;
}

export function resolveTrustedTimestamp(
  candidate: TimestampCandidate
): ResolvedTimestamp | null {
  const timestampRule: unknown = candidate.timestampRule;
  if (timestampRule !== EXPLICIT_ZONED_DATETIME_RULE) return null;
  const rawDatetime = candidate.rawDatetime;
  if (
    rawDatetime.length === 0 ||
    rawDatetime !== rawDatetime.trim() ||
    hasControlCharacter(rawDatetime)
  ) return null;
  const zoneMatch = rawDatetime.match(ZONE);
  if (!zoneMatch) return null;
  const zone = zoneMatch[0];
  if (!hasKnownNumericZone(zone)) return null;
  const dateTime = rawDatetime.slice(0, -zone.length);
  if (!COMPLETE_DATE_TIME.test(dateTime)) return null;
  const separatorIndex = Math.max(dateTime.indexOf("T"), dateTime.indexOf(" "));
  const time = dateTime.slice(separatorIndex + 1);
  if (/[Z+-]/.test(time)) return null;
  const instant = parseISO(candidate.rawDatetime);
  if (!isValid(instant)) return null;
  return {
    source: candidate.source,
    sourceDatetime: candidate.rawDatetime,
    instant
  };
}
