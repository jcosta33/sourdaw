import { recordedControllerTakeState } from '../../repositories/webMidi/recordedControllerTakeState';

/**
 * Drop a clip's buffered rows and its starting pedals and bend range unwritten, for a commit
 * that will not land (its owning track is gone), so nothing waits for a clip
 * that no longer exists.
 */
export function discardRecordedControllers(clipId: string): void {
    const { buffers, heldPedalSeeds, bendRangeSeeds } = recordedControllerTakeState;
    buffers.delete(clipId);
    heldPedalSeeds.delete(clipId);
    bendRangeSeeds.delete(clipId);
}
