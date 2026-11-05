import { getTrackById } from '../../../repositories/track/getTrackById';

import { commitSendEdit } from './commitSendEdit';
import { compileSendLevelAction } from './compileSendLevelAction';

const pendingCommits = new Map<string, Promise<void>>();

function sendCommitKey(trackId: string, busId: string): string {
    return `${trackId}\u0000${busId}`;
}

function readProjectSend(trackId: string, busId: string) {
    return getTrackById(trackId)?.sends.find((send) => send.busId === busId);
}

/**
 * Commits one send-level gesture. Gestures on one send apply in the order they
 * were made, and each is compiled against the send as the project holds it when
 * its turn comes. A key step taken before the previous step's write lands then
 * guards on that write, not on the level the slider last rendered, which the
 * handler would refuse as stale.
 */
export function commitSendLevel(trackId: string, busId: string, level: number): Promise<void> {
    const key = sendCommitKey(trackId, busId);
    const previous = pendingCommits.get(key) ?? Promise.resolve();
    const commit = previous.then(() =>
        commitSendEdit(compileSendLevelAction(trackId, busId, level, readProjectSend(trackId, busId)))
    );
    pendingCommits.set(key, commit);
    void commit.then(() => {
        if (pendingCommits.get(key) === commit) {
            pendingCommits.delete(key);
        }
    });
    return commit;
}
