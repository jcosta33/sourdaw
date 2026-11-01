/**
 * Read seams for the buffer ids the runtime cache must answer for.
 *
 * Scheduling and offline renders read PCM synchronously from the runtime
 * cache, so its LRU must never evict a buffer a clip or frozen track still
 * plays. A project load pins only the ids it loaded; a take recorded, a file
 * imported or a bounce made later in the session is referenced without being
 * pinned, and enough unrelated cache writes (the first-launch factory seed
 * alone caches more than the cap) would otherwise evict it and leave the clip
 * silent in playback and export. The live reader answers for those, and for a
 * buffer cached before anything places it (a prepared stem import its agent
 * run still owns).
 *
 * A buffer only undo or redo can bring back is different: nothing plays it
 * until the replay lands, and the history that names it has no cap. The
 * history reader names those ids so the cache keeps each one until its PCM is
 * durably stored, and lets it go after that: the replay rehydrates it from
 * storage before it applies.
 *
 * The references live in the arrangement, the undo history and the agent runs,
 * none of which this store imports, so the composition root injects the
 * readers. With no reader registered, nothing beyond the pinned and held sets
 * is protected.
 */
export type LiveAudioBufferReferenceReader = () => Iterable<string>;

let liveReader: LiveAudioBufferReferenceReader | null = null;
let historyReader: LiveAudioBufferReferenceReader | null = null;

export function setLiveAudioBufferReferenceReader(next: LiveAudioBufferReferenceReader | null): void {
    liveReader = next;
}

export function setHistoryAudioBufferReferenceReader(next: LiveAudioBufferReferenceReader | null): void {
    historyReader = next;
}

export function readLiveAudioBufferReferences(): ReadonlySet<string> {
    return new Set(liveReader?.() ?? []);
}

export function readHistoryAudioBufferReferences(): ReadonlySet<string> {
    return new Set(historyReader?.() ?? []);
}
