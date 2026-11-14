import { clarify } from '../../models/LastCommitRefusal';
import { type ProjectContext } from '../../models/ProjectContext';

import { type LastCommitContinuation, type RetargetRequest } from './lastCommitOutcome';
import { readNamedTracks } from './readNamedTracks';

type ReadTargets = { status: 'named'; ids: string[] } | { status: 'refused'; outcome: LastCommitContinuation };

/** The tracks a re-target names, or the question a stretch it cannot read as tracks asks. */
export function readRetargetTracks(request: RetargetRequest, context: ProjectContext): ReadTargets {
    const named = readNamedTracks(request.targetText, context);
    if (named.status === 'ambiguous') {
        return {
            status: 'refused',
            outcome: clarify(
                `"${named.text}" names more than one track.`,
                `Which track should take the last change: ${named.names.join(' or ')}?`
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
