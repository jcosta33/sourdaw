import { recordedControllerTakeState } from '../../repositories/webMidi/recordedControllerTakeState';

import { discardRecordedControllers } from './discardRecordedControllers';
import { planRecordedControllers, type RecordedClipSpan } from './planRecordedControllers';
import { writeRecordedControllerRows } from './writeRecordedControllerRows';

type CommitRecordedControllersInput = {
    /** The clip as the commit lands it: the take ended where this clip does. */
    clip: RecordedClipSpan;
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
export function commitRecordedControllers({ clip }: CommitRecordedControllersInput): void {
    const clipId = clip.id;
    const rows = planRecordedControllers({ clip });
    discardRecordedControllers(clipId);
    const { openedClipIds, committedClipIds, carriedOverClipIds } = recordedControllerTakeState;
    if (carriedOverClipIds.delete(clipId)) {
        openedClipIds.delete(clipId);
    } else {
        committedClipIds.add(clipId);
    }
    writeRecordedControllerRows({ clipId, ...rows });
}
