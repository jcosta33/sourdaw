import {
    setHistoryAudioBufferReferenceReader,
    type LiveAudioBufferReferenceReader,
} from '../stores/liveAudioBufferReferences';

/**
 * Hand the audio cache the reader for the buffer ids only undo or redo can
 * bring back, or `null` to detach it. The cache keeps each of those buffers
 * until its PCM is durably stored and may evict it after that, so a replay
 * rehydrates what it needs first (`prepareCachedAudioBuffersForReplay`). The
 * composition root makes this binding because the undo history owns the ids.
 */
export function configureHistoryAudioBufferReferences(next: LiveAudioBufferReferenceReader | null): void {
    setHistoryAudioBufferReferenceReader(next);
}
