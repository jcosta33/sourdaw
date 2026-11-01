/**
 * Read seam for the buffer ids the open arrangement references right now.
 *
 * Scheduling and offline renders read PCM synchronously from the runtime
 * cache, so its LRU must never evict a buffer a clip or frozen track still
 * plays. A project load pins only the ids it loaded; a take recorded, a file
 * imported or a bounce made later in the session is referenced without being
 * pinned, and enough unrelated cache writes (the first-launch factory seed
 * alone caches more than the cap) would otherwise evict it and leave the clip
 * silent in playback and export.
 *
 * The same holds for a buffer only undo or redo can bring back, and for one
 * cached before anything places it (a prepared stem import awaiting its
 * confirmed placement): the reader answers for everything a synchronous read
 * can still need, not the open arrangement alone.
 *
 * The references live in the arrangement, the undo history and the agent runs,
 * none of which this store imports, so the composition root injects the
 * reader. With no reader registered, nothing beyond the pinned set is protected.
 */
export type LiveAudioBufferReferenceReader = () => readonly string[];

let reader: LiveAudioBufferReferenceReader | null = null;

export function setLiveAudioBufferReferenceReader(next: LiveAudioBufferReferenceReader | null): void {
    reader = next;
}

export function readLiveAudioBufferReferences(): ReadonlySet<string> {
    return new Set(reader?.() ?? []);
}
