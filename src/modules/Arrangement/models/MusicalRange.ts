/**
 * The musical range law: how a range a person names — a section, a run of bars, or a span of
 * beats — becomes the half-open beat interval an edit writes into.
 *
 * Sections are matched by name. An exact name match wins outright; otherwise the reference is read
 * as an optional ordinal and a name family ("chorus 2", "the second chorus", "the last verse"),
 * where a family is every section whose name reduces to the same base once a trailing number is
 * dropped, ordered by where it starts. The law never guesses between equal matches: two sections
 * that answer a reference equally are reported as ambiguous with both candidates, so the caller can
 * ask rather than pick.
 *
 * A reference no section answers is read against the markers, by the same rules. A marker is a
 * named position, the way a Reaper marker or an Ableton locator is, so the range it opens runs to
 * the next boundary after it: the nearest later marker or section start, or else the end of the
 * arrangement. Sections take precedence, because a section states its own end and a marker does not.
 */

import { getArrangementEndBeat } from './ArrangementEnd';

export type MusicalRangeSection = {
    id: string;
    name: string;
    startBeat: number;
    endBeat: number;
};

/** A range as a caller states it: exactly one of a section reference, a bar range, or a beat range. */
export type MusicalRangeReference = {
    /** A section name, optionally with an ordinal: "Chorus", "chorus 2", "the second chorus", "the last verse". */
    section?: string;
    /** First bar of the range, 1-based. */
    startBar?: number;
    /** Last bar of the range, inclusive: the range ends where the next bar opens. */
    endBar?: number;
    /** Range start, in beats. */
    startBeat?: number;
    /** Range end, in beats, exclusive. */
    endBeat?: number;
};

export type MusicalRangeCandidate = MusicalRangeSection;

export type MusicalRangeResolution =
    | { kind: 'resolved'; startBeat: number; endBeat: number; section?: MusicalRangeSection }
    | { kind: 'ambiguous-section'; reference: string; candidates: MusicalRangeCandidate[]; reason: string }
    | { kind: 'unknown-section'; reference: string; reason: string }
    | { kind: 'invalid-range'; reason: string };

export type MusicalRangeMarker = {
    id: string;
    name: string;
    beat: number;
};

export type MusicalRangeSources = {
    sections: readonly MusicalRangeSection[];
    markers: readonly MusicalRangeMarker[];
    /** The arrangement's tracks, read only for where their last clip ends. */
    tracks: readonly { clips: readonly { endBeat: number }[] }[];
    /** The beat a 1-based bar opens on through the project's meter map, or null for no such bar. */
    barStartBeat: (bar: number) => number | null;
};

const ORDINAL_WORDS: Readonly<Record<string, number>> = {
    first: 1,
    second: 2,
    third: 3,
    fourth: 4,
    fifth: 5,
    sixth: 6,
    seventh: 7,
    eighth: 8,
    ninth: 9,
    tenth: 10,
};

const LAST_WORDS: ReadonlySet<string> = new Set(['last', 'final']);

/** "2nd", "3rd", "11th": a numeric ordinal with its English suffix. */
const NUMERIC_ORDINAL = /^(?<count>\d+)(?:st|nd|rd|th)$/u;

/** A trailing count on a name or a reference: "Chorus 2", "chorus #2". */
const TRAILING_COUNT = /^(?<base>.+?)\s+#?(?<count>\d+)$/u;

/**
 * A position in a name family. `count` is a number written after the name ("chorus 2"), which in a
 * family whose names carry numbers is a name rather than a position; `ordinal` is a word or a
 * suffixed number before it ("second chorus", "2nd chorus"), which always counts by position.
 */
type SectionOrdinal = { kind: 'index'; index: number; written: 'count' | 'ordinal' } | { kind: 'last' };

type FamilyReference = { base: string; ordinal: SectionOrdinal | null };

function normalizeName(name: string): string {
    return name.trim().replaceAll(/\s+/gu, ' ').toLocaleLowerCase();
}

/** The family a section name belongs to: its normalized name without a trailing count. */
function familyBaseOf(name: string): string {
    const normalized = normalizeName(name);
    return TRAILING_COUNT.exec(normalized)?.groups?.base ?? normalized;
}

function parseLeadingOrdinal(word: string): SectionOrdinal | null {
    if (LAST_WORDS.has(word)) {
        return { kind: 'last' };
    }
    const fromWord = ORDINAL_WORDS[word];
    if (fromWord !== undefined) {
        return { kind: 'index', index: fromWord, written: 'ordinal' };
    }
    const count = NUMERIC_ORDINAL.exec(word)?.groups?.count;
    return count === undefined ? null : { kind: 'index', index: Number(count), written: 'ordinal' };
}

function parseFamilyReference(reference: string): FamilyReference {
    const normalized = normalizeName(reference).replace(/^the\s+/u, '');
    const trailing = TRAILING_COUNT.exec(normalized)?.groups;
    if (trailing?.base !== undefined && trailing.count !== undefined) {
        return { base: trailing.base, ordinal: { kind: 'index', index: Number(trailing.count), written: 'count' } };
    }
    const [firstWord = '', ...rest] = normalized.split(' ');
    const leading = rest.length > 0 ? parseLeadingOrdinal(firstWord) : null;
    if (leading !== null) {
        return { base: rest.join(' '), ordinal: leading };
    }
    return { base: normalized, ordinal: null };
}

function describeCandidates(candidates: readonly MusicalRangeSection[]): string {
    return candidates
        .map((section) => `"${section.name}" (beats ${String(section.startBeat)}–${String(section.endBeat)})`)
        .join(', ');
}

/** The section as a range names it: its identity, its name, and the beats it spans. */
function toRangeSection({ id, name, startBeat, endBeat }: MusicalRangeSection): MusicalRangeSection {
    return { id, name, startBeat, endBeat };
}

/** What the places a reference is read against are called, for the reasons it reports. */
type PlaceKind = 'section' | 'marker';

function ambiguous(
    reference: string,
    candidates: readonly MusicalRangeSection[],
    kind: PlaceKind
): MusicalRangeResolution {
    return {
        kind: 'ambiguous-section',
        reference,
        candidates: candidates.map(toRangeSection),
        reason: `"${reference}" matches ${String(candidates.length)} ${kind}s equally: ${describeCandidates(candidates)}.`,
    };
}

function resolvedSection(section: MusicalRangeSection, kind: PlaceKind): MusicalRangeResolution {
    if (!(section.endBeat > section.startBeat)) {
        return {
            kind: 'invalid-range',
            reason: `The ${kind} "${section.name}" covers no beats: its range ends at beat ${String(section.endBeat)}, which is not after its start at beat ${String(section.startBeat)}.`,
        };
    }
    return {
        kind: 'resolved',
        startBeat: section.startBeat,
        endBeat: section.endBeat,
        section: toRangeSection(section),
    };
}

/** The places a reference picks out, every one of them answering it equally, or why it picks none. */
type PlaceSelection =
    { kind: 'selected'; places: readonly MusicalRangeSection[] } | { kind: 'unknown'; reason: string };

function selected(places: readonly MusicalRangeSection[]): PlaceSelection {
    return { kind: 'selected', places };
}

function selectByOrdinal(
    reference: string,
    family: readonly MusicalRangeSection[],
    ordinal: SectionOrdinal,
    kind: PlaceKind
): PlaceSelection {
    const position = ordinal.kind === 'last' ? family.length - 1 : ordinal.index - 1;
    const atPosition = family[position];
    if (atPosition === undefined) {
        return {
            kind: 'unknown',
            reason: `"${reference}" names ${kind} ${String(position + 1)} of its name, but the project has ${String(family.length)}.`,
        };
    }
    return selected(family.filter((section) => section.startBeat === atPosition.startBeat));
}

/** Sections whose whole name is the reference, read with and then without a leading "the". */
function findExactNameMatches(
    reference: string,
    sections: readonly MusicalRangeSection[]
): readonly MusicalRangeSection[] {
    const normalizedReference = normalizeName(reference);
    const matching = (name: string) => sections.filter((section) => normalizeName(section.name) === name);
    const literal = matching(normalizedReference);
    const withoutArticle = normalizedReference.replace(/^the\s+/u, '');
    return literal.length > 0 || withoutArticle === normalizedReference ? literal : matching(withoutArticle);
}

function selectFamilyMembers(
    reference: string,
    places: readonly MusicalRangeSection[],
    kind: PlaceKind
): PlaceSelection {
    const { base, ordinal } = parseFamilyReference(reference);
    const family = places
        .filter((place) => familyBaseOf(place.name) === base)
        .sort((first, second) => first.startBeat - second.startBeat);
    if (family.length === 0) {
        return { kind: 'unknown', reason: `No section or marker in the project is named "${reference}".` };
    }
    if (ordinal === null) {
        return selected(family);
    }
    if (ordinal.kind === 'index' && ordinal.written === 'count' && family.some(carriesCount)) {
        return {
            kind: 'unknown',
            reason: `No ${kind} is named "${reference}"; the ${kind}s of that name are ${describeCandidates(family)}.`,
        };
    }
    return selectByOrdinal(reference, family, ordinal, kind);
}

/** Whether a place's own name ends in a number, so a number a reference states names rather than counts. */
function carriesCount(place: MusicalRangeSection): boolean {
    return TRAILING_COUNT.test(normalizeName(place.name));
}

/** The places of one kind a reference picks: an exact name first, then a name family. */
function selectNamedPlaces(reference: string, places: readonly MusicalRangeSection[], kind: PlaceKind): PlaceSelection {
    const exact = findExactNameMatches(reference, places);
    return exact.length > 0 ? selected(exact) : selectFamilyMembers(reference, places, kind);
}

/** The reference read against one kind of place: one pick resolves, several are ambiguous. */
function resolveNamedPlace(
    reference: string,
    places: readonly MusicalRangeSection[],
    kind: PlaceKind
): MusicalRangeResolution {
    const selection = selectNamedPlaces(reference, places, kind);
    if (selection.kind === 'unknown') {
        return { kind: 'unknown-section', reference, reason: selection.reason };
    }
    const [only, ...others] = selection.places;
    if (only !== undefined && others.length === 0) {
        return resolvedSection(only, kind);
    }
    return ambiguous(reference, selection.places, kind);
}

/** The nearest marker or section start after a beat, or `Infinity` when nothing follows it. */
function nextBoundaryAfter(beat: number, sources: MusicalRangeSources): number {
    const boundaries = [
        ...sources.markers.map((marker) => marker.beat),
        ...sources.sections.map((section) => section.startBeat),
    ];
    return Math.min(...boundaries.filter((boundary) => boundary > beat));
}

/**
 * Each marker as the range it opens: from its beat to the nearest later marker or section start,
 * or else to the end of the arrangement. A marker nothing closes spans no beats, and is refused as
 * such if a reference names it.
 */
function toMarkerRanges(sources: MusicalRangeSources): MusicalRangeSection[] {
    const arrangementEndBeat = getArrangementEndBeat(sources.tracks);
    return sources.markers.map((marker) => {
        const nextBoundary = nextBoundaryAfter(marker.beat, sources);
        let endBeat = marker.beat;
        if (Number.isFinite(nextBoundary)) {
            endBeat = nextBoundary;
        } else if (arrangementEndBeat > marker.beat) {
            endBeat = arrangementEndBeat;
        }
        return { id: marker.id, name: marker.name, startBeat: marker.beat, endBeat };
    });
}

function resolveSectionReference(reference: string, sources: MusicalRangeSources): MusicalRangeResolution {
    if (normalizeName(reference) === '') {
        return { kind: 'invalid-range', reason: 'A section reference must name a section.' };
    }
    const bySection = resolveNamedPlace(reference, sources.sections, 'section');
    if (bySection.kind !== 'unknown-section') {
        return bySection;
    }
    const byMarker = resolveNamedPlace(reference, toMarkerRanges(sources), 'marker');
    return byMarker.kind === 'unknown-section' ? bySection : byMarker;
}

function resolveBeatRange(startBeat: number, endBeat: number): MusicalRangeResolution {
    if (!Number.isFinite(startBeat) || !Number.isFinite(endBeat) || startBeat < 0) {
        return { kind: 'invalid-range', reason: 'A beat range needs finite beats that start at or after beat 0.' };
    }
    if (!(endBeat > startBeat)) {
        return {
            kind: 'invalid-range',
            reason: `The range ends at beat ${String(endBeat)}, which is not after its start at beat ${String(startBeat)}.`,
        };
    }
    return { kind: 'resolved', startBeat, endBeat };
}

function resolveBarRange(
    startBar: number,
    endBar: number,
    barStartBeat: MusicalRangeSources['barStartBeat']
): MusicalRangeResolution {
    if (!Number.isInteger(startBar) || !Number.isInteger(endBar) || startBar < 1) {
        return { kind: 'invalid-range', reason: 'A bar range names whole bars, counted from bar 1.' };
    }
    if (endBar < startBar) {
        return {
            kind: 'invalid-range',
            reason: `The range ends at bar ${String(endBar)}, before it starts at bar ${String(startBar)}.`,
        };
    }
    const startBeat = barStartBeat(startBar);
    const endBeat = barStartBeat(endBar + 1);
    if (startBeat === null || endBeat === null) {
        return { kind: 'invalid-range', reason: 'The project meter cannot place those bars on the timeline.' };
    }
    return resolveBeatRange(startBeat, endBeat);
}

function isStated(value: unknown): boolean {
    return value !== undefined;
}

/**
 * The beat interval a stated range covers, or why it covers none.
 *
 * Exactly one form must be stated: a section reference, a bar range with both ends, or a beat
 * range with both ends. Mixing forms, or stating half of one, is refused rather than settled by a
 * precedence the caller cannot see.
 */
export function resolveMusicalRangeReference(
    reference: MusicalRangeReference,
    sources: MusicalRangeSources
): MusicalRangeResolution {
    const statesSection = isStated(reference.section);
    const statesBars = isStated(reference.startBar) || isStated(reference.endBar);
    const statesBeats = isStated(reference.startBeat) || isStated(reference.endBeat);
    if ([statesSection, statesBars, statesBeats].filter(Boolean).length !== 1) {
        return {
            kind: 'invalid-range',
            reason: 'State the range exactly once: a section, a bar range, or a beat range.',
        };
    }
    if (reference.section !== undefined) {
        return resolveSectionReference(reference.section, sources);
    }
    if (statesBars) {
        if (reference.startBar === undefined || reference.endBar === undefined) {
            return { kind: 'invalid-range', reason: 'A bar range needs both its first and its last bar.' };
        }
        return resolveBarRange(reference.startBar, reference.endBar, sources.barStartBeat);
    }
    if (reference.startBeat === undefined || reference.endBeat === undefined) {
        return { kind: 'invalid-range', reason: 'A beat range needs both its start and its end.' };
    }
    return resolveBeatRange(reference.startBeat, reference.endBeat);
}

/**
 * What a stated range is read against: the sections and markers a name is matched among, the
 * arrangement end that bounds a marker nothing follows, and the meter that places bars. A beat
 * range reads nothing. An edit to any of these can move the beats the range resolves to.
 */
export type MusicalRangeInput = 'places' | 'arrangement-end' | 'meter';

/**
 * A name reads the sections and markers it is matched among, and the arrangement end only when a
 * marker it picks has nothing after it: another marker running to the end bounds no range this
 * name resolves to.
 */
function namedPlaceInputs(reference: string, sources: MusicalRangeSources): readonly MusicalRangeInput[] {
    if (selectNamedPlaces(reference, sources.sections, 'section').kind === 'selected') {
        return ['places'];
    }
    const byMarker = selectNamedPlaces(reference, toMarkerRanges(sources), 'marker');
    const picksOpenMarker =
        byMarker.kind === 'selected' &&
        byMarker.places.some((marker) => !Number.isFinite(nextBoundaryAfter(marker.startBeat, sources)));
    return picksOpenMarker ? ['places', 'arrangement-end'] : ['places'];
}

export function getMusicalRangeInputs(
    reference: MusicalRangeReference,
    sources: MusicalRangeSources
): readonly MusicalRangeInput[] {
    if (reference.section !== undefined) {
        return namedPlaceInputs(reference.section, sources);
    }
    if (isStated(reference.startBar) || isStated(reference.endBar)) {
        return ['meter'];
    }
    return [];
}
