import {
    setLiveAudioBufferReferenceReader,
    type LiveAudioBufferReferenceReader,
} from '../stores/liveAudioBufferReferences';

/**
 * Hand the audio cache the reader for the buffer ids the open arrangement
 * references, or `null` to detach it. The cache never evicts those ids, so a
 * clip added after the project loaded keeps its PCM for playback and export.
 * The composition root makes this binding because the arrangement owns the
 * references and the reader must see every later edit.
 */
export function configureLiveAudioBufferReferences(next: LiveAudioBufferReferenceReader | null): void {
    setLiveAudioBufferReferenceReader(next);
}
