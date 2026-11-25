import { clarify } from '../../models/LastCommitRefusal';
import { type ProjectContext } from '../../models/ProjectContext';
import { ORDINAL_WORDS } from '../agentReference/ordinalWords';

import { type LastCommitContinuation, type RetargetRequest } from './lastCommitOutcome';
import { type AmbiguousTrack, readNamedTracks } from './readNamedTracks';
import { readsAsAnotherTrack } from './readsAsAnotherTrack';

type ReadTargets = { status: 'named'; ids: string[] } | { status: 'refused'; outcome: LastCommitContinuation };

/** The option labels of the which-track question; `ordered` when same-named tracks are labelled by order. */
type CandidateOptions =
    { status: 'options'; labels: string[]; ordered: boolean } | { status: 'unlabellable'; name: string };

/** Items joined as a list is written: "Bass", "Bass and Keys", "Bass, Keys and Pads". */
function joinAsList(items: readonly string[]): string {
    if (items.length < 2) {
        return items.join('');
    }
    return `${items.slice(0, -1).join(', ')} and ${items.slice(-1).join('')}`;
}

function describeOptions(labels: readonly string[], ordered: boolean): string {
    if (!ordered) {
        return labels.join(' or ');
    }
    return `${labels.slice(0, -1).join(', ')} or ${labels.slice(-1).join('')}, counting from the top of the track list`;
}

/**
 * The which-track question. Beside the rest of a list it names those tracks and shows the whole list
 * written again with the first option, since the answer is a new request and keeps only what it names.
 */
function askWhichTrack(
    text: string,
    labels: readonly string[],
    ordered: boolean,
    rest: readonly string[]
): ReadTargets {
    const options = describeOptions(labels, ordered);
    const reason = `"${text}" names more than one track.`;
    if (rest.length === 0) {
        return { status: 'refused', outcome: clarify(reason, `Which track should take the last change: ${options}?`) };
    }
    const example = joinAsList([...labels.slice(0, 1), ...rest]);
    const question = `Which track should take the last change beside ${joinAsList(rest)}: ${options}? Name the whole list again, as in "do the same to ${example}".`;
    return { status: 'refused', outcome: clarify(reason, question) };
}

/**
 * The options of the which-track question: same-named candidates by order among them, the rest by
 * name. An order label the answer reader could not read back as that track (its words also name
 * another track, or the order has no ordinal word) is never offered.
 */
function describeCandidates(candidates: readonly AmbiguousTrack[], context: ProjectContext): CandidateOptions {
    const tracks = context.tracks.map((track) => ({ id: track.id, name: track.name }));
    function shares(candidate: AmbiguousTrack): boolean {
        return candidates.filter((other) => other.name.toLowerCase() === candidate.name.toLowerCase()).length > 1;
    }
    if (!candidates.some(shares)) {
        return { status: 'options', labels: candidates.map((candidate) => candidate.name), ordered: false };
    }
    const options: string[] = [];
    for (const candidate of candidates) {
        if (!shares(candidate)) {
            options.push(candidate.name);
            continue;
        }
        const ordinal = ORDINAL_WORDS[candidate.order - 1];
        const label = `the ${ordinal ?? ''} ${candidate.name}`;
        if (ordinal === undefined || readsAsAnotherTrack(label, candidate.name, tracks)) {
            return { status: 'unlabellable', name: candidate.name };
        }
        options.push(label);
    }
    return { status: 'options', labels: options, ordered: true };
}

function askToRename(text: string, name: string): ReadTargets {
    return {
        status: 'refused',
        outcome: clarify(
            `"${text}" names more than one track.`,
            `Which track should take the last change? Tracks named ${name} cannot be told apart by order here; rename one of them and ask again.`
        ),
    };
}

/** The tracks a re-target names, or the question a stretch it cannot read as tracks asks. */
export function readRetargetTracks(request: RetargetRequest, context: ProjectContext): ReadTargets {
    const named = readNamedTracks(request.targetText, context);
    if (named.status === 'collision') {
        return askToRename(named.text, named.name);
    }
    if (named.status === 'ambiguous') {
        const options = describeCandidates(named.candidates, context);
        if (options.status === 'unlabellable') {
            return askToRename(named.text, options.name);
        }
        return askWhichTrack(named.text, options.labels, options.ordered, named.rest);
    }
    if (named.status === 'unread') {
        return {
            status: 'refused',
            outcome: clarify(
                `"${request.targetText}" is not a list of this project's tracks.`,
                'Which tracks should take the last change? Name them, as in "do the same to Bass and Keys".'
            ),
        };
    }
    return named;
}
