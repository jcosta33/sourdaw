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
 * Call it from the commit's `execute`, inside its storage transaction, so a
 * commit that does not land writes nothing. The rows written are the ones
 * `planRecordedControllers` named while the commit described its redo snapshot.
 */
export function commitRecordedControllers({ clipId }: CommitRecordedControllersInput): void {
    const rows = planRecordedControllers({ clipId });
    discardRecordedControllers(clipId);
    recordedControllerTakeState.committedClipIds.add(clipId);
    writeRecordedControllerRows({ clipId, ...rows });
}
