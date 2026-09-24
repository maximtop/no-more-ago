/**
 * @file Classifies page-owned timestamp labels without deriving timestamp values.
 */

import {
    TIMESTAMP_PRESENTATION_KIND,
    type TimestampCandidate,
    type TimestampPresentationContext,
    type TimestampSourceRule,
} from './types';

/**
 * Canonical locale set shared by relative-label classification and tests.
 */
export const CANONICAL_RELATIVE_TIME_LOCALES = [
    'ar', 'bg', 'ca', 'cs', 'da', 'de', 'el', 'en', 'es', 'es-419',
    'fa', 'fi', 'fil', 'fr', 'he', 'hi', 'hr', 'hu', 'id', 'it',
    'ja', 'ko', 'lt', 'nb', 'nl', 'pl', 'pt-BR', 'pt-PT', 'ro', 'ru',
    'sk', 'sl', 'sr', 'sv', 'th', 'tr', 'uk', 'vi', 'zh-CN', 'zh-TW',
] as const;

/**
 * Finite pattern families an adapter may authorize for its visible labels.
 */
export const RELATIVE_PRESENTATION_PROFILE = {
    DIRECTIONAL: 'directional',
    COMPACT_AGE: 'compact-age',
} as const;

/**
 * One locale admitted by the confirmed product locale contract.
 */
type CanonicalRelativeTimeLocale = (typeof CANONICAL_RELATIVE_TIME_LOCALES)[number];

/**
 * One classifier pattern family explicitly selected by an adapter.
 */
type RelativePresentationProfile = (typeof RELATIVE_PRESENTATION_PROFILE)[keyof typeof RELATIVE_PRESENTATION_PROFILE];

const RELATIVE_UNITS = [
    'second', 'minute', 'hour', 'day', 'week', 'month', 'quarter', 'year',
] as const;
const COMPACT_UNITS = [
    'second', 'minute', 'hour', 'day', 'week', 'month', 'year',
] as const;
const STYLES = ['long', 'short', 'narrow'] as const;
const UNIT_DISPLAYS = ['short', 'narrow'] as const;
const NUMBER_TOKEN = '{number}' as const;

/**
 * Maximum page-owned timestamp-label length accepted by presentation parsers.
 */
export const MAX_PRESENTATION_TEXT_LENGTH = 512;

const MAX_PRESENTATION_NODE_COUNT = 64;
const DEFAULT_IGNORABLES = /[\p{Cf}\u034f]/gu;
const NUMBER_SEQUENCE = /[\p{Number}]+/gu;
const PLURAL_SAMPLE_CANDIDATES = [
    ...Array.from({ length: 201 }, (_, value) => value),
    ...Array.from({ length: 200 }, (_, index) => (index + 1) / 10),
    1_000,
    10_000,
    100_000,
    1_000_000,
    10_000_000,
];

/**
 * Finite intersection of compact-unit signatures and absolute Intl date/time fragments.
 *
 * This map is precomputed with the required Node 24 Intl data from every one- and
 * two-field date/time combination across representative months, weekdays, and hours.
 * The behavior test reconstructs that corpus so an ICU change fails closed.
 */
const COMPACT_CALENDAR_COLLISIONS: Partial<
    Record<CanonicalRelativeTimeLocale, readonly string[]>
> = {
    ar: [
        '{number} أ', '{number} ث', '{number} د', '{number} س', '{number} ي',
    ],
    bg: ['{number} г.', '{number} д', '{number} с', '{number} ч'],
    cs: ['{number} s'],
    da: ['{number} m', '{number} s', '{number} t'],
    de: ['{number} m'],
    el: ['{number} δ', '{number} μ'],
    es: ['{number} a', '{number} d', '{number} s'],
    'es-419': ['{number} s'],
    fi: ['{number} s', '{number} t'],
    fil: ['{number} linggo'],
    fr: ['{number} h', '{number} j', '{number} s'],
    hi: ['{number} दि'],
    hu: ['{number} p'],
    id: ['{number} j'],
    it: ['{number} s'],
    ko: ['{number}년', '{number}일'],
    lt: ['{number} s'],
    nb: ['{number} m', '{number} t'],
    nl: ['{number} d', '{number} m', '{number} s', '{number} w'],
    pl: ['{number} s'],
    'pt-BR': ['{number} s'],
    'pt-PT': ['{number} s'],
    ro: [
        '{number} a', '{number} l', '{number} luni', '{number} m', '{number} s',
    ],
    ru: ['{number} с', '{number} ч'],
    sk: ['{number} s'],
    sl: ['{number} s', '{number} t'],
    sr: ['{number} н', '{number} с', '{number} ч'],
    sv: ['{number} d', '{number} mån', '{number} s'],
    uk: ['{number} с'],
    vi: ['{number} giờ'],
    'zh-CN': ['{number}年'],
};
const directionalCache = new Map<CanonicalRelativeTimeLocale, ReadonlySet<string>>();
const compactCache = new Map<CanonicalRelativeTimeLocale, ReadonlySet<string>>();

/**
 * Normalizes one page label without interpreting its timestamp.
 *
 * @param value - Current page-owned label.
 *
 * @returns - Anchored comparison signature with numbers replaced by one token.
 */
function labelSignature(value: string): string {
    return value.normalize('NFKC')
        .replace(DEFAULT_IGNORABLES, '')
        .trim()
        .replace(/\s+/gu, ' ')
        .toLowerCase()
        .replace(NUMBER_SEQUENCE, NUMBER_TOKEN);
}

/**
 * Converts structured Intl output into the same normalized label signature.
 * Numeric separators remain literal so an absolute numeric date cannot
 * collapse into a one-number compact-age signature.
 *
 * @param parts - Structured output from one Intl formatter.
 *
 * @returns - Signature comparable with a normalized page label.
 */
function partsSignature(
    parts: readonly { readonly type: string; readonly value: string }[],
): string {
    return labelSignature(parts.map(({ value }) => value).join(''));
}

/**
 * Selects one numeric sample for every cardinal plural category.
 *
 * @param locale - Canonical locale whose plural forms are needed.
 *
 * @returns - Minimal sample collection found within the bounded candidate set.
 */
function pluralSamples(locale: CanonicalRelativeTimeLocale): readonly number[] {
    const rules = new Intl.PluralRules(locale);
    const required = new Set(rules.resolvedOptions().pluralCategories);
    const samples = new Map<Intl.LDMLPluralRule, number>();
    for (const value of PLURAL_SAMPLE_CANDIDATES) {
        const category = rules.select(value);
        if (!samples.has(category)) {
            samples.set(category, value);
        }
        if (samples.size === required.size) {
            break;
        }
    }
    return [...samples.values()];
}

/**
 * Builds exact past, future, and named relative signatures for one locale.
 *
 * @param locale - Canonical locale whose directional patterns are needed.
 *
 * @returns - Cached normalized directional signatures.
 */
function directionalPatterns(
    locale: CanonicalRelativeTimeLocale,
): ReadonlySet<string> {
    const cached = directionalCache.get(locale);
    if (cached) {
        return cached;
    }
    const patterns = new Set<string>();
    const samples = pluralSamples(locale);
    for (const style of STYLES) {
        const always = new Intl.RelativeTimeFormat(locale, {
            numeric: 'always',
            style,
        });
        const automatic = new Intl.RelativeTimeFormat(locale, {
            numeric: 'auto',
            style,
        });
        for (const unit of RELATIVE_UNITS) {
            for (const sample of samples) {
                patterns.add(partsSignature(always.formatToParts(-sample, unit)));
                patterns.add(partsSignature(always.formatToParts(sample, unit)));
            }
            for (const value of [-2, -1, 0, 1, 2]) {
                patterns.add(partsSignature(automatic.formatToParts(value, unit)));
            }
        }
    }
    directionalCache.set(locale, patterns);
    return patterns;
}

/**
 * Builds localized bare number-plus-unit signatures for proven age widgets.
 *
 * @param locale - Canonical locale whose compact patterns are needed.
 *
 * @returns - Cached normalized number-plus-unit signatures.
 */
function compactAgePatterns(
    locale: CanonicalRelativeTimeLocale,
): ReadonlySet<string> {
    const cached = compactCache.get(locale);
    if (cached) {
        return cached;
    }
    const patterns = new Set<string>();
    const absolute = new Set(COMPACT_CALENDAR_COLLISIONS[locale] ?? []);
    const samples = pluralSamples(locale);
    for (const unitDisplay of UNIT_DISPLAYS) {
        for (const unit of COMPACT_UNITS) {
            const formatter = new Intl.NumberFormat(locale, {
                style: 'unit',
                unit,
                unitDisplay,
            });
            for (const sample of samples) {
                const signature = partsSignature(formatter.formatToParts(sample));
                if (!absolute.has(signature)) {
                    patterns.add(signature);
                }
            }
        }
    }
    compactCache.set(locale, patterns);
    return patterns;
}

/**
 * Maps one BCP 47 request into the confirmed locale set.
 *
 * @param value - Page or browser locale request.
 *
 * @returns - One normalized supported locale, or an empty collection.
 */
function canonicalLocales(value: string): readonly CanonicalRelativeTimeLocale[] {
    let locale: Intl.Locale;
    try {
        locale = new Intl.Locale(value);
    } catch {
        return [];
    }
    const exact = CANONICAL_RELATIVE_TIME_LOCALES.find(
        (candidate) => candidate.toLowerCase() === locale.baseName.toLowerCase(),
    );
    if (exact) {
        return [exact];
    }
    if (locale.language === 'zh') {
        return locale.script === 'Hant' || ['TW', 'HK', 'MO'].includes(locale.region ?? '')
            ? ['zh-TW']
            : ['zh-CN'];
    }
    if (locale.language === 'pt') {
        return locale.region === 'BR' ? ['pt-BR'] : ['pt-PT'];
    }
    if (locale.language === 'es' && locale.region && locale.region !== 'ES') {
        return ['es-419'];
    }
    const language = CANONICAL_RELATIVE_TIME_LOCALES.find(
        (candidate) => candidate === locale.language,
    );
    return language ? [language] : [];
}

/**
 * Resolves inherited page language before browser preferences.
 *
 * @param source - Element that owns the classified label.
 * @param preferred - Current browser locale preference snapshot.
 *
 * @returns - Ordered supported locales, or an empty collection when evidence fails closed.
 */
export function activePresentationLocales(
    source: Element,
    preferred: readonly string[],
): readonly CanonicalRelativeTimeLocale[] {
    if (source.querySelector('[lang]')) {
        return [];
    }
    const nearest = source.closest('[lang]');
    if (nearest) {
        return canonicalLocales(nearest.getAttribute('lang') ?? '');
    }
    const root = source.ownerDocument.documentElement;
    if (root.hasAttribute('lang')) {
        return canonicalLocales(root.getAttribute('lang') ?? '');
    }
    const locales = new Set<CanonicalRelativeTimeLocale>();
    for (const value of preferred) {
        for (const locale of canonicalLocales(value)) {
            locales.add(locale);
        }
    }
    return [...locales];
}

/**
 * Classifies one visible label without deriving or changing its timestamp.
 *
 * @param text - Exact current page-owned timestamp label.
 * @param source - Element supplying inherited language semantics.
 * @param preferredLocales - Current browser locale preference snapshot.
 * @param profiles - Adapter-approved relative pattern families.
 * @param additionalPatterns - Extra adapter-owned templates normalized like page labels.
 *
 * @returns - Whether the complete normalized label is recognized as relative.
 */
export function isRelativeLabelText(
    text: string,
    source: Element,
    preferredLocales: readonly string[],
    profiles: readonly RelativePresentationProfile[],
    additionalPatterns: readonly string[] = [],
): boolean {
    if (text.length > MAX_PRESENTATION_TEXT_LENGTH) {
        return false;
    }
    const signature = labelSignature(text);
    if (signature.length === 0) {
        return false;
    }
    const locales = activePresentationLocales(source, preferredLocales);
    if (locales.length === 0) {
        return false;
    }
    if (locales.some((locale) => (COMPACT_CALENDAR_COLLISIONS[locale] ?? []).includes(signature))) {
        return false;
    }
    if (additionalPatterns.some((pattern) => labelSignature(pattern) === signature)) {
        return true;
    }
    return locales.some((locale) => profiles.some((profile) => {
        const patterns = profile === RELATIVE_PRESENTATION_PROFILE.DIRECTIONAL
            ? directionalPatterns(locale)
            : compactAgePatterns(locale);
        return patterns.has(signature);
    }));
}

/**
 * Selects the subtree that renders a source element's visible label.
 *
 * Custom elements such as GitHub's `relative-time` render the label users see
 * into an open shadow root and keep an absolute fallback in light DOM, so the
 * shadow root is the label whenever one is attached.
 *
 * @param source - Element that owns the candidate label.
 *
 * @returns - Open shadow root, or the element itself.
 */
function visibleLabelRoot(source: Element): Node {
    return source.shadowRoot ?? source;
}

/**
 * Checks whether one candidate label subtree stays within the fixed node budget.
 *
 * @param root - Candidate adjacent-label root.
 *
 * @returns - Whether the complete subtree fits the observation budget.
 */
function hasBoundedPresentationSubtree(root: Node): boolean {
    const remaining: Node[] = [root];
    let visited = 0;
    while (remaining.length > 0) {
        const node = remaining.pop();
        if (!node) {
            continue;
        }
        visited += 1;
        if (visited > MAX_PRESENTATION_NODE_COUNT) {
            return false;
        }
        let child = node.lastChild;
        while (child) {
            remaining.push(child);
            child = child.previousSibling;
        }
    }
    return true;
}

/**
 * Reads one adjacent label without traversing unbounded page-controlled content.
 *
 * @param root - Candidate adjacent-label root.
 *
 * @returns - DOM-order text, or null after either fixed budget is exceeded.
 */
function readBoundedPresentationText(root: Node): string | null {
    const remaining: Node[] = [root];
    let text = '';
    let visited = 0;
    while (remaining.length > 0) {
        const node = remaining.pop();
        if (!node) {
            continue;
        }
        visited += 1;
        if (visited > MAX_PRESENTATION_NODE_COUNT) {
            return null;
        }
        if (node.nodeType === Node.TEXT_NODE) {
            const value = (node as Text).data;
            if (text.length + value.length > MAX_PRESENTATION_TEXT_LENGTH) {
                return null;
            }
            text += value;
            continue;
        }
        let child = node.lastChild;
        while (child) {
            remaining.push(child);
            child = child.previousSibling;
        }
    }
    return text;
}

/**
 * Reads only the current page-owned segment selected by a candidate.
 *
 * @param candidate - Trusted-source candidate carrying presentation ownership.
 * @param context - Current route, locales, and retained page-text capabilities.
 *
 * @returns - Label and language-owning element, or null when no label exists.
 */
export function readTimestampPresentationText(
    candidate: TimestampCandidate,
    context: TimestampPresentationContext,
): { readonly source: Element; readonly text: string } | null {
    const { presentation } = candidate;
    if (presentation.kind === TIMESTAMP_PRESENTATION_KIND.ADJACENT_TIME) {
        const text = readBoundedPresentationText(visibleLabelRoot(candidate.source));
        return text === null ? null : { source: candidate.source, text };
    }
    const pageText = context.readPageText(presentation.target);
    const prefix = presentation.textPrefix ?? '';
    const suffix = presentation.textSuffix ?? '';
    if (!pageText.startsWith(prefix) || !pageText.endsWith(suffix)) {
        return null;
    }
    const end = suffix.length === 0 ? pageText.length : -suffix.length;
    const text = pageText.slice(prefix.length, end);
    const source = presentation.target.parentElement ?? candidate.source;
    return { source, text };
}

/**
 * Selects the smallest bounded page node whose text controls candidate eligibility.
 *
 * @param candidate - Trusted-source candidate carrying presentation ownership.
 *
 * @returns - Exact Text target, bounded adjacent source, or null for a large subtree.
 */
export function getRelativePresentationObservationTarget(
    candidate: TimestampCandidate,
): Node | null {
    if (candidate.presentation.kind === TIMESTAMP_PRESENTATION_KIND.IN_PLACE_TEXT) {
        return candidate.presentation.target;
    }
    const root = visibleLabelRoot(candidate.source);
    return hasBoundedPresentationSubtree(root) ? root : null;
}

/**
 * Applies locale profiles to the exact page-owned label carried by a candidate.
 *
 * @param candidate - Trusted-source candidate whose presentation is classified.
 * @param context - Current locales and retained page-text capabilities.
 * @param profiles - Adapter-approved relative pattern families.
 * @param additionalPatterns - Extra adapter-owned normalized templates.
 *
 * @returns - Whether the candidate has an existing recognized relative label.
 */
export function isRelativeTimestampPresentation(
    candidate: TimestampCandidate,
    context: TimestampPresentationContext,
    profiles: readonly RelativePresentationProfile[],
    additionalPatterns: readonly string[] = [],
): boolean {
    const presentation = readTimestampPresentationText(candidate, context);
    return presentation !== null && isRelativeLabelText(
        presentation.text,
        presentation.source,
        context.locales,
        profiles,
        additionalPatterns,
    );
}

/**
 * Creates one adapter classifier while keeping its allowed profiles local.
 *
 * @param profiles - Adapter-approved relative pattern families.
 * @param additionalPatterns - Extra adapter-owned normalized templates.
 *
 * @returns - Rule callback that classifies the candidate's page-owned label.
 */
export function createRelativePresentationClassifier(
    profiles: readonly RelativePresentationProfile[],
    additionalPatterns: readonly string[] = [],
): TimestampSourceRule['isRelativePresentation'] {
    return (candidate, context) => isRelativeTimestampPresentation(
        candidate,
        context,
        profiles,
        additionalPatterns,
    );
}
