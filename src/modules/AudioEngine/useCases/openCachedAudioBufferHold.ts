import { openAudioBufferResidencyHold, type AudioBufferResidencyHold } from '../stores/audioBufferResidencyHolds';

/**
 * Open a scoped hold that keeps the cache from evicting the ids it retains:
 * buffers an operation is writing and has not handed to their owner yet.
 * Retain each id before its cache write and release the hold in a `finally`
 * once the owner references the id, or the operation failed.
 */
export function openCachedAudioBufferHold(): AudioBufferResidencyHold {
    return openAudioBufferResidencyHold();
}
