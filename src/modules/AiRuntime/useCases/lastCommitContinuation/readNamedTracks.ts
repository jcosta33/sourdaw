import { type ProjectContext } from '../../models/ProjectContext';
import { getBestAgentReferenceNameRanges } from '../agentReference/getBestAgentReferenceNameRanges';

/** Words a list of track names may hold besides the names themselves. */
const TARGET_LIST_WORDS: ReadonlySet<string> = new Set(['the', 'and', '&', 'both', 'track', 'tracks']);

/** Words that join two names of a list; a comma joins them too. */
const LIST_JOINERS: ReadonlySet<string> = new Set(['and', '&']);

type NamedTracks =
    { status: 'named'; ids: string[] } | { status: 'ambiguous'; text: string; names: string[] } | { status: 'unread' };

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
    const ranges = getBestAgentReferenceNameRanges(text, tracks, 'with-number-forms').toSorted(
        (left, right) => left.start - right.start || left.end - right.end
    );
    for (const [index, range] of ranges.entries()) {
        const next = ranges[index + 1];
        if (next !== undefined && next.start < range.end) {
            const shared = ranges.filter((candidate) => candidate.start < range.end && candidate.end > range.start);
            return {
                status: 'ambiguous',
                text: text.slice(range.start, Math.max(range.end, next.end)),
                names: [
                    ...new Set(
                        shared.map((candidate) => tracks.find((track) => track.id === candidate.id)?.name ?? '')
                    ),
                ],
            };
        }
    }
    let rest = text;
    for (const range of ranges) {
        rest = `${rest.slice(0, range.start)}${' '.repeat(range.end - range.start)}${rest.slice(range.end)}`;
    }
    const words = rest
        .toLowerCase()
        .split(/[\s,]+/u)
        .filter((word) => word.length > 0);
    if (ranges.length === 0 || words.some((word) => !TARGET_LIST_WORDS.has(word)) || !joinsEveryName(text, ranges)) {
        return { status: 'unread' };
    }
    return { status: 'named', ids: [...new Set(ranges.map((range) => range.id))] };
}
