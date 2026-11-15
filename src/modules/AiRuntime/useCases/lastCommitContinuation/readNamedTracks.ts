import { type ProjectContext } from '../../models/ProjectContext';
import { getBestAgentReferenceNameRanges } from '../agentReference/getBestAgentReferenceNameRanges';

/** Words a list of track names may hold besides the names themselves. */
const TARGET_LIST_WORDS: ReadonlySet<string> = new Set(['the', 'and', '&', 'both', 'track', 'tracks']);

/** Words that join two names of a list; a comma joins them too. */
const LIST_JOINERS: ReadonlySet<string> = new Set(['and', '&']);

/** An ambiguous candidate: `order` is its 1-based place among the tracks sharing its whole name, from the top of the track list. */
export type AmbiguousTrack = { id: string; name: string; order: number };

type NamedTracks =
    | { status: 'named'; ids: string[] }
    | { status: 'ambiguous'; text: string; candidates: AmbiguousTrack[] }
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

function escapeRegExp(text: string): string {
    return text.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
}

function sameName(left: string, right: string): boolean {
    return left.toLowerCase() === right.toLowerCase();
}

/** The 1-based place of a track among the tracks sharing its whole name, counting from the top of the list. */
function orderAmongSameName(track: ListedTrack, tracks: readonly ListedTrack[]): number {
    return tracks.filter((candidate) => sameName(candidate.name, track.name)).findIndex((c) => c.id === track.id) + 1;
}

type OrdinalReading =
    { status: 'read'; ranges: NamedRange[] } | { status: 'beyond-the-tracks'; text: string; sharing: ListedTrack[] };

/**
 * The "[the] second Lead" references of the text, each the k-th track of that whole name. A phrase
 * that is itself a track's whole name ("First Lead") is left to the name reading, and an ordinal past
 * the tracks sharing the name reads nothing but names those tracks, so the caller can ask which.
 */
function readOrdinalRanges(text: string, tracks: readonly ListedTrack[]): OrdinalReading {
    const names = [...new Set(tracks.map((track) => track.name.toLowerCase()))].toSorted(
        (left, right) => right.length - left.length
    );
    const ranges: NamedRange[] = [];
    const taken = (start: number, end: number): boolean =>
        ranges.some((range) => range.start < end && range.end > start);
    for (const name of names) {
        const pattern = new RegExp(
            String.raw`(?<![\p{L}\p{N}])(?:the\s+)?(${ORDINAL_WORDS.join('|')})\s+${escapeRegExp(name)}(?![\p{L}\p{N}])`,
            'giu'
        );
        for (const match of text.matchAll(pattern)) {
            const start = match.index;
            const end = start + match[0].length;
            const phrase = match[0].replace(/^the\s+/iu, '');
            if (tracks.some((track) => sameName(track.name, phrase)) || taken(start, end)) {
                continue;
            }
            const sharing = tracks.filter((track) => sameName(track.name, name));
            const target = sharing[ORDINAL_WORDS.indexOf(match[1]!.toLowerCase())];
            if (target === undefined) {
                return { status: 'beyond-the-tracks', text: match[0], sharing };
            }
            ranges.push({ id: target.id, start, end });
        }
    }
    return { status: 'read', ranges };
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

/**
 * The tracks the text names by whole name, in either grammatical number, through the shared
 * resolver's own reading, and nothing else: any word besides the names and the list's own joiners,
 * or two names with no joiner between them, leaves it unread, and a stretch two tracks' names read
 * equally well is ambiguous.
 */
export function readNamedTracks(text: string, context: ProjectContext): NamedTracks {
    const tracks = context.tracks.map((track) => ({ id: track.id, name: track.name }));
    const ordinal = readOrdinalRanges(text, tracks);
    if (ordinal.status === 'beyond-the-tracks') {
        // One track of the name (or none) leaves the leftover ordinal word unread, as the name reading does.
        if (ordinal.sharing.length < 2) {
            return { status: 'unread' };
        }
        return {
            status: 'ambiguous',
            text: ordinal.text,
            candidates: ordinal.sharing.map((track) => ({ ...track, order: orderAmongSameName(track, tracks) })),
        };
    }
    const ranges = [
        ...getBestAgentReferenceNameRanges(blank(text, ordinal.ranges), tracks, 'with-number-forms'),
        ...ordinal.ranges,
    ].toSorted((left, right) => left.start - right.start || left.end - right.end);
    for (const [index, range] of ranges.entries()) {
        const next = ranges[index + 1];
        if (next !== undefined && next.start < range.end) {
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
    const words = blank(text, ranges)
        .toLowerCase()
        .split(/[\s,]+/u)
        .filter((word) => word.length > 0);
    if (ranges.length === 0 || words.some((word) => !TARGET_LIST_WORDS.has(word)) || !joinsEveryName(text, ranges)) {
        return { status: 'unread' };
    }
    return { status: 'named', ids: [...new Set(ranges.map((range) => range.id))] };
}
