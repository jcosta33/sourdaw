import { type ProjectContext } from '../../models/ProjectContext';
import { getBestAgentReferenceNameRanges } from '../agentReference/getBestAgentReferenceNameRanges';
import { escapeRegExp } from '../agentReference/groundingStrategies/escapeRegExp';

/** Words a list of track names may hold besides the names themselves. */
const TARGET_LIST_WORDS: ReadonlySet<string> = new Set(['the', 'and', '&', 'both', 'track', 'tracks']);

/** Words that join two names of a list; a comma joins them too. */
const LIST_JOINERS: ReadonlySet<string> = new Set(['and', '&']);

/** An ambiguous candidate: `order` is its 1-based place among the tracks sharing its whole name, from the top of the track list. */
export type AmbiguousTrack = { id: string; name: string; order: number };

type NamedTracks =
    | { status: 'named'; ids: string[] }
    | { status: 'ambiguous'; text: string; candidates: AmbiguousTrack[] }
    | { status: 'collision'; text: string; name: string }
    | { status: 'unread' };

type NamedRange = { id: string; start: number; end: number };

/** The ordinal words a list may use to pick one of several same-named tracks. */
export const ORDINAL_WORDS: readonly string[] = [
    'first',
    'second',
    'third',
    'fourth',
    'fifth',
    'sixth',
    'seventh',
    'eighth',
    'ninth',
    'tenth',
];

type ListedTrack = { id: string; name: string };

function sameName(left: string, right: string): boolean {
    return left.toLowerCase() === right.toLowerCase();
}

/** The 1-based place of a track among the tracks sharing its whole name, counting from the top of the list. */
function orderAmongSameName(track: ListedTrack, tracks: readonly ListedTrack[]): number {
    return tracks.filter((candidate) => sameName(candidate.name, track.name)).findIndex((c) => c.id === track.id) + 1;
}

type Span = { start: number; end: number };

type OrdinalAsk =
    | { status: 'beyond-the-tracks'; text: string; sharing: ListedTrack[] }
    | { status: 'collision'; text: string; name: string };

/** The order references read, every order phrase the text holds, and the first phrase that must be asked about. */
type OrdinalReading = { ranges: NamedRange[]; phrases: Span[]; ask: OrdinalAsk | undefined };

/**
 * The "[the] second Lead" references of the text, each the k-th track of that whole name. A phrase
 * whose words also name another track is no order reference: for a name one track holds it is left to
 * the name reading, and for a shared name it is a collision the caller must ask about. An ordinal past
 * the tracks sharing the name reads nothing but names those tracks, so the caller can ask which. Every
 * phrase is read, past the first ask too, so the caller can check the whole text as one list.
 */
function readOrdinalRanges(text: string, tracks: readonly ListedTrack[]): OrdinalReading {
    const names = [...new Set(tracks.map((track) => track.name.toLowerCase()))].toSorted(
        (left, right) => right.length - left.length
    );
    const otherNameRanges = getBestAgentReferenceNameRanges(text, tracks, 'with-number-forms');
    function isOf(range: NamedRange, name: string): boolean {
        return sameName(tracks.find((track) => track.id === range.id)?.name ?? '', name);
    }
    const ranges: NamedRange[] = [];
    const phrases: Span[] = [];
    let ask: OrdinalAsk | undefined;
    function taken(start: number, end: number): boolean {
        return phrases.some((phrase) => phrase.start < end && phrase.end > start);
    }
    for (const name of names) {
        const pattern = new RegExp(
            String.raw`(?<![\p{L}\p{N}])(?:the\s+)?(${ORDINAL_WORDS.join('|')})\s+${escapeRegExp(name)}(?![\p{L}\p{N}])`,
            'giu'
        );
        for (const match of text.matchAll(pattern)) {
            const start = match.index;
            const end = start + match[0].length;
            if (taken(start, end)) {
                continue;
            }
            const sharing = tracks.filter((track) => sameName(track.name, name));
            const crossing = otherNameRanges.filter(
                (range) => range.start < end && range.end > start && !isOf(range, name)
            );
            // A longer name the phrase cuts into is that track's to read, as without ordinals.
            if (crossing.some((range) => range.start < start || range.end > end)) {
                continue;
            }
            if (crossing.length > 0) {
                if (sharing.length >= 2) {
                    phrases.push({ start, end });
                    ask ??= { status: 'collision', text: match[0], name: sharing[0]!.name };
                }
                continue;
            }
            phrases.push({ start, end });
            const target = sharing[ORDINAL_WORDS.indexOf(match[1]!.toLowerCase())];
            if (target === undefined) {
                ask ??= { status: 'beyond-the-tracks', text: match[0], sharing };
                continue;
            }
            ranges.push({ id: target.id, start, end });
        }
    }
    return { ranges, phrases, ask };
}

function blank(text: string, ranges: ReadonlyArray<{ start: number; end: number }>): string {
    return ranges.reduce(
        (rest, range) => `${rest.slice(0, range.start)}${' '.repeat(range.end - range.start)}${rest.slice(range.end)}`,
        text
    );
}

/** Whether a joiner stands between every two names, as a list of names needs: "Bass and Keys", never "Bass Keys". */
function joinsEveryName(text: string, ranges: ReadonlyArray<{ start: number; end: number }>): boolean {
    return ranges.slice(1).every((range, index) => {
        const between = text.slice(ranges[index]!.end, range.start).toLowerCase();
        return between.includes(',') || between.split(/\s+/u).some((word) => LIST_JOINERS.has(word));
    });
}

/** Whether every word outside the ranges is one of the list's own words. */
function holdsOnlyListWords(text: string, ranges: ReadonlyArray<{ start: number; end: number }>): boolean {
    return blank(text, ranges)
        .toLowerCase()
        .split(/[\s,]+/u)
        .filter((word) => word.length > 0)
        .every((word) => TARGET_LIST_WORDS.has(word));
}

/** Whether the text is nothing but the ranges, the list's own words and a joiner between every two ranges. */
function readsAsList(text: string, ranges: ReadonlyArray<{ start: number; end: number }>): boolean {
    return ranges.length > 0 && holdsOnlyListWords(text, ranges) && joinsEveryName(text, ranges);
}

/** Every order phrase beside every other name the text reads, in text order, as one list to check. */
function listWithPhrases(text: string, phrases: readonly Span[], tracks: readonly ListedTrack[]): Span[] {
    const others = getBestAgentReferenceNameRanges(blank(text, phrases), tracks, 'with-number-forms');
    return [...others, ...phrases].toSorted((left, right) => left.start - right.start || left.end - right.end);
}

/** What an order phrase the text must be asked about reads as; every ask is a verdict about a list. */
function readOrdinalAsk(
    text: string,
    ask: OrdinalAsk,
    phrases: readonly Span[],
    tracks: readonly ListedTrack[]
): NamedTracks {
    // Text that is otherwise no list stays unread, as it does without ordinals.
    if (!readsAsList(text, listWithPhrases(text, phrases, tracks))) {
        return { status: 'unread' };
    }
    if (ask.status === 'collision') {
        return { status: 'collision', text: ask.text, name: ask.name };
    }
    // One track of the name (or none) leaves the leftover ordinal word unread, as the name reading does.
    if (ask.sharing.length < 2) {
        return { status: 'unread' };
    }
    return {
        status: 'ambiguous',
        text: ask.text,
        candidates: ask.sharing.map((track) => ({ ...track, order: orderAmongSameName(track, tracks) })),
    };
}

/**
 * The tracks the text names by whole name, in either grammatical number, through the shared
 * resolver's own reading, and nothing else: any word besides the names and the list's own joiners,
 * or two names with no joiner between them, leaves it unread, and a stretch two tracks' names read
 * equally well is ambiguous.
 */
export function readNamedTracks(text: string, context: ProjectContext): NamedTracks {
    const tracks = context.tracks.map((track) => ({ id: track.id, name: track.name }));
    const ordinal = readOrdinalRanges(text, tracks);
    if (ordinal.ask !== undefined) {
        return readOrdinalAsk(text, ordinal.ask, ordinal.phrases, tracks);
    }
    const ranges = [
        ...getBestAgentReferenceNameRanges(blank(text, ordinal.ranges), tracks, 'with-number-forms'),
        ...ordinal.ranges,
    ].toSorted((left, right) => left.start - right.start || left.end - right.end);
    for (const [index, range] of ranges.entries()) {
        const next = ranges[index + 1];
        if (next !== undefined && next.start < range.end) {
            if (!holdsOnlyListWords(text, ranges)) {
                return { status: 'unread' };
            }
            const shared = ranges.filter((candidate) => candidate.start < range.end && candidate.end > range.start);
            const ids = new Set(shared.map((candidate) => candidate.id));
            return {
                status: 'ambiguous',
                text: text.slice(range.start, Math.max(range.end, next.end)),
                candidates: tracks
                    .filter((track) => ids.has(track.id))
                    .map((track) => ({ ...track, order: orderAmongSameName(track, tracks) })),
            };
        }
    }
    if (!readsAsList(text, ranges)) {
        return { status: 'unread' };
    }
    return { status: 'named', ids: [...new Set(ranges.map((range) => range.id))] };
}
