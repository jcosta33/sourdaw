import { getTrackById } from '../../../repositories/track/getTrackById';

import { commitSendEdit } from './commitSendEdit';
import { compileSendLevelAction } from './compileSendLevelAction';
import { restoreSendEngineFromProjectTruth } from './restoreSendEngineFromProjectTruth';

const pendingCommits = new Map<string, Promise<void>>();

function sendCommitKey(trackId: string, busId: string): string {
    return `${trackId}\u0000${busId}`;
}

function readProjectSend(trackId: string, busId: string) {
    return getTrackById(trackId)?.sends.find((send) => send.busId === busId);
}

/** A send already at the level, or no send where the level is silence. */
function projectHoldsLevel(send: { level: number } | undefined, level: number): boolean {
    return send ? send.level === level : level === 0;
}

function commitWhenChanged(trackId: string, busId: string, level: number): Promise<void> {
    const send = readProjectSend(trackId, busId);
    if (projectHoldsLevel(send, level)) {
        // A gesture that ended where the project already is writes nothing,
        // and the engine its preview moved follows the project again.
        restoreSendEngineFromProjectTruth(trackId, busId);
        return Promise.resolve();
    }
    return commitSendEdit(compileSendLevelAction(trackId, busId, level, send));
}

/**
 * Commits one send-level gesture. Gestures on one send apply in the order they
 * were made, and each is compiled against the send as the project holds it when
 * its turn comes. A key step taken before the previous step's write lands then
 * guards on that write, not on the level the slider last rendered, which the
 * handler would refuse as stale. A gesture whose level the project already
 * holds at its turn writes nothing; its promise still settles.
 */
export function commitSendLevel(trackId: string, busId: string, level: number): Promise<void> {
    const key = sendCommitKey(trackId, busId);
    const previous = pendingCommits.get(key) ?? Promise.resolve();
    const commit = previous.then(() => commitWhenChanged(trackId, busId, level));
    pendingCommits.set(key, commit);
    void commit.then(() => {
        if (pendingCommits.get(key) === commit) {
            pendingCommits.delete(key);
        }
    });
    return commit;
}
