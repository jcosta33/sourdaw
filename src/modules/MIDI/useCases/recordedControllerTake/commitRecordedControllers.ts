import { recordedControllerTakeState } from '../../repositories/webMidi/recordedControllerTakeState';

import { discardRecordedControllers } from './discardRecordedControllers';
import { planRecordedControllers } from './planRecordedControllers';
import { writeRecordedControllerRows } from './writeRecordedControllerRows';

type CommitRecordedControllersInput = {
    clipId: string;
};

/**
 * Take a committing clip's rows out of the take buffer and write them into the
 * clip in one store write, and close the clip to further rows: a message
 * arriving after this belongs to no take.
 *
 * The exception is a commit that lands while a later take is recording into the
 * clip (the commit waited behind a snapshot transaction). That take owns what
 * it records from here on: the clip stops waiting for a commit, so the take's
 * falling edge writes those rows like any overdub.
 *
 * Call it from the commit's `execute`, inside its storage transaction, so a
 * commit that does not land writes nothing. The rows written are the ones
 * `planRecordedControllers` named while the commit described its redo snapshot.
 */
export function commitRecordedControllers({ clipId }: CommitRecordedControllersInput): void {
    const rows = planRecordedControllers({ clipId });
    discardRecordedControllers(clipId);
    const { openedClipIds, committedClipIds, carriedOverClipIds } = recordedControllerTakeState;
    if (carriedOverClipIds.delete(clipId)) {
        openedClipIds.delete(clipId);
    } else {
        committedClipIds.add(clipId);
    }
    writeRecordedControllerRows({ clipId, ...rows });
}
