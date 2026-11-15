import { clarify } from '../../models/LastCommitRefusal';
import { type ProjectContext } from '../../models/ProjectContext';

import { type LastCommitContinuation, type RetargetRequest } from './lastCommitOutcome';
import { type AmbiguousTrack, ORDINAL_WORDS, readNamedTracks } from './readNamedTracks';

type ReadTargets = { status: 'named'; ids: string[] } | { status: 'refused'; outcome: LastCommitContinuation };

/** The options of the which-track question: same-named candidates by order, the rest by name. */
function describeCandidates(candidates: readonly AmbiguousTrack[]): string {
    const shares = (candidate: AmbiguousTrack): boolean =>
        candidates.filter((other) => other.name.toLowerCase() === candidate.name.toLowerCase()).length > 1;
    if (!candidates.some(shares)) {
        return candidates.map((candidate) => candidate.name).join(' or ');
    }
    const options = candidates.map((candidate) =>
        shares(candidate)
            ?`the ${ORDINAL_WORDS[candidate.order - 1] ?? String(candidate.order)} ${candidate.name}`
            : candidate.name
    );
    const last = options.at(-1);
    return `${options.slice(0, -1).join(', ')} or ${last}, counting from the top of the track list`;
}

/** The tracks a re-target names, or the question a stretch it cannot read as tracks asks. */
export function readRetargetTracks(request: RetargetRequest, context: ProjectContext): ReadTargets {
    const named = readNamedTracks(request.targetText, context);
    if (named.status === 'ambiguous') {
        return {
            status: 'refused',
            outcome: clarify(
                `"${named.text}" names more than one track.`,
                `Which track should take the last change: ${describeCandidates(named.candidates)}?`
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
