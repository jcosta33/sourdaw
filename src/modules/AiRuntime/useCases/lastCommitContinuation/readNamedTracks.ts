import { type ProjectContext } from '../../models/ProjectContext';
import { getBestAgentReferenceNameRanges } from '../agentReference/getBestAgentReferenceNameRanges';
import { escapeRegExp } from '../agentReference/groundingStrategies/escapeRegExp';
import { ORDINAL_WORDS } from '../agentReference/ordinalWords';

/** Words a list of track names may hold besides the names themselves. */
const TARGET_LIST_WORDS: ReadonlySet<string> = new Set(['the', 'and', '&', 'both', 'track', 'tracks']);

/** Words that join two names of a list; a comma joins them too. */
const LIST_JOINERS: ReadonlySet<string> = new Set(['and', '&']);

/** An ambiguous candidate: `order` is its 1-based place among the tracks sharing its whole name, from the top of the track list. */
export type AmbiguousTrack = { id: string; name: string; order: number };

/**
 * What the text names. An ambiguous reading also carries `rest`: every other stretch of the list, as
 * the text writes it, so the question can keep the rest of the list beside the stretch it asks about.
 */
type NamedTracks =
    | { status: 'named'; ids: string[] }
    | { status: 'ambiguous'; text: string; candidates: AmbiguousTrack[]; rest: string[] }
    | { status: 'collision'; text: string; name: string }
    | { status: 'unread' };

type NamedRange = { id: string; start: number; end: number };

type ListedTrack = { id: string; name: string };

function sameName(left: string, right: string): boolean {
    return left.toLowerCase() === right.toLowerCase();
}

/** The 1-based place of a track among the tracks sharing its whole name, counting from the top of the list. */
function orderAmongSameName(track: ListedTrack, tracks: readonly ListedTrack[]): number {
    return tracks.filter((candidate) => sameName(candidate.name, track.name)).findIndex((c) => c.id === track.id) + 1;
}

type Span = { start: number; end: number };

type OrdinalAsk = Span &
    (
        | { status: 'beyond-the-tracks'; text: string; sharing: ListedTrack[] }
        | { status: 'collision'; text: string; name: string }
    );

/** The order references read, every order phrase the text holds, and every phrase that must be asked about. */
type OrdinalReading = { ranges: NamedRange[]; phrases: Span[]; asks: OrdinalAsk[] };

/**
 * The "[the] second Lead" references of the text, each the k-th track of that whole name. A phrase
 * whose words also name another track is no order reference: for a name one track holds it is left to
 * the name reading, and for a shared name it is a collision the caller must ask about. An ordinal past
 * the tracks sharing the name reads nothing but names those tracks, so the caller can ask which. Every
 * phrase is read, past an ask too, so the caller can check the whole text as one list and choose the ask.
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
    const asks: OrdinalAsk[] = [];
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
                const [owner] = sharing;
                if (sharing.length >= 2 && owner !== undefined) {
                    phrases.push({ start, end });
                    asks.push({ status: 'collision', start, end, text: match[0], name: owner.name });
                }
                continue;
            }
            phrases.push({ start, end });
            const target = sharing[ORDINAL_WORDS.indexOf(match[1]!.toLowerCase())];
            if (target === undefined) {
                asks.push({ status: 'beyond-the-tracks', start, end, text: match[0], sharing });
                continue;
            }
            ranges.push({ id: target.id, start, end });
        }
    }
    return { ranges, phrases, asks };
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
        const previous = ranges[index];
        if (previous === undefined) {
            return false;
        }
        const between = text.slice(previous.end, range.start).toLowerCase();
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

/** A stretch of the text one or more ranges read; `members` counts them, so a stretch of two or more is read two ways. */
type Stretch = Span & { members: number };

/** The ranges, sorted by start, merged into the stretches their overlaps make. */
function stretchesOf(ranges: readonly Span[]): Stretch[] {
    const stretches: Stretch[] = [];
    for (const range of ranges) {
        const last = stretches.at(-1);
        if (last !== undefined && range.start < last.end) {
            stretches[stretches.length - 1] = {
                start: last.start,
                end: Math.max(last.end, range.end),
                members: last.members + 1,
            };
            continue;
        }
        stretches.push({ start: range.start, end: range.end, members: 1 });
    }
    return stretches;
}

/** Every stretch but the one asked about, as the text writes it. */
function restOf(text: string, stretches: readonly Stretch[], asked: Span): string[] {
    return stretches
        .filter((stretch) => stretch.end <= asked.start || stretch.start >= asked.end)
        .map((stretch) => text.slice(stretch.start, stretch.end));
}

/** Every order phrase beside every other name the text reads, in text order, as one list to check. */
function listWithPhrases(text: string, phrases: readonly Span[], tracks: readonly ListedTrack[]): Span[] {
    const others = getBestAgentReferenceNameRanges(blank(text, phrases), tracks, 'with-number-forms');
    return [...others, ...phrases].toSorted((left, right) => left.start - right.start || left.end - right.end);
}

/**
 * What a text holding order phrases that must be asked about reads as; every ask is a verdict about a
 * list. One phrase that reads nothing leaves the whole list unread; otherwise a rename ask comes before
 * a which-track ask, since no answer can pick a track the order cannot tell apart, and among asks of
 * one kind the first in the text is asked, whichever track its name belongs to.
 */
function readOrdinalAsks(
    text: string,
    asks: readonly OrdinalAsk[],
    phrases: readonly Span[],
    tracks: readonly ListedTrack[]
): NamedTracks {
    const list = listWithPhrases(text, phrases, tracks);
    // Text that is otherwise no list stays unread, as it does without ordinals.
    if (!readsAsList(text, list)) {
        return { status: 'unread' };
    }
    // One track of the name (or none) leaves the leftover ordinal word unread, as the name reading does.
    if (asks.some((ask) => ask.status === 'beyond-the-tracks' && ask.sharing.length < 2)) {
        return { status: 'unread' };
    }
    const inTextOrder = asks.toSorted((left, right) => left.start - right.start);
    const [firstAsk] = inTextOrder;
    const asked = inTextOrder.find((ask) => ask.status === 'collision') ?? firstAsk;
    if (asked === undefined) {
        return { status: 'unread' };
    }
    if (asked.status === 'collision') {
        return { status: 'collision', text: asked.text, name: asked.name };
    }
    return {
        status: 'ambiguous',
        text: asked.text,
        candidates: asked.sharing.map((track) => ({ ...track, order: orderAmongSameName(track, tracks) })),
        rest: restOf(text, stretchesOf(list), asked),
    };
}

/** The which-track question for the first stretch two tracks' names read equally, keeping the rest of the list. */
function askWhichOfStretch(
    text: string,
    asked: Stretch,
    ranges: readonly NamedRange[],
    tracks: readonly ListedTrack[]
): NamedTracks {
    const ids = new Set(
        ranges.filter((range) => range.start < asked.end && range.end > asked.start).map((range) => range.id)
    );
    return {
        status: 'ambiguous',
        text: text.slice(asked.start, asked.end),
        candidates: tracks
            .filter((track) => ids.has(track.id))
            .map((track) => ({ ...track, order: orderAmongSameName(track, tracks) })),
        rest: restOf(text, stretchesOf(ranges), asked),
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
    if (ordinal.asks.length > 0) {
        return readOrdinalAsks(text, ordinal.asks, ordinal.phrases, tracks);
    }
    const ranges = [
        ...getBestAgentReferenceNameRanges(blank(text, ordinal.ranges), tracks, 'with-number-forms'),
        ...ordinal.ranges,
    ].toSorted((left, right) => left.start - right.start || left.end - right.end);
    const stretches = stretchesOf(ranges);
    if (!readsAsList(text, stretches)) {
        return { status: 'unread' };
    }
    const shared = stretches.find((stretch) => stretch.members > 1);
    if (shared !== undefined) {
        return askWhichOfStretch(text, shared, ranges, tracks);
    }
    return { status: 'named', ids: [...new Set(ranges.map((range) => range.id))] };
}
