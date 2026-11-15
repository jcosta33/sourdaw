import { clarify } from '../../models/LastCommitRefusal';
import { type ProjectContext } from '../../models/ProjectContext';

import { type LastCommitContinuation, type RetargetRequest } from './lastCommitOutcome';
import { type AmbiguousTrack, ORDINAL_WORDS, readNamedTracks, readsAsAnotherTrack } from './readNamedTracks';

type ReadTargets = { status: 'named'; ids: string[] } | { status: 'refused'; outcome: LastCommitContinuation };

type CandidateOptions = { status: 'options'; text: string } | { status: 'unlabellable'; name: string };

/**
 * The options of the which-track question: same-named candidates by order among them, the rest by
 * name. An order label the answer reader could not read back as that track (its words also name
 * another track, or the order has no ordinal word) is never offered.
 */
function describeCandidates(candidates: readonly AmbiguousTrack[], context: ProjectContext): CandidateOptions {
    const tracks = context.tracks.map((track) => ({ id: track.id, name: track.name }));
    const shares = (candidate: AmbiguousTrack): boolean =>
        candidates.filter((other) => other.name.toLowerCase() === candidate.name.toLowerCase()).length > 1;
    if (!candidates.some(shares)) {
        return { status: 'options', text: candidates.map((candidate) => candidate.name).join(' or ') };
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
    const last = options.at(-1);
    return {
        status: 'options',
        text: `${options.slice(0, -1).join(', ')} or ${last}, counting from the top of the track list`,
    };
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
        return {
            status: 'refused',
            outcome: clarify(
                `"${named.text}" names more than one track.`,
                `Which track should take the last change: ${options.text}?`
            ),
        };
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
