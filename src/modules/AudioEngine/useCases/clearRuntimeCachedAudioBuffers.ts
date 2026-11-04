import { clearRuntimeAudioBufferCache } from '../stores/audioBufferCache';

import { nativeTimelineMaterialOwner } from './livePlayback/nativeTimelineMaterialOwner';

type ClearRuntimeCachedAudioBuffersInput = {
    retainedIds?: Iterable<string>;
    /** Window quiesce can be cancelled; preserve decoded web material for repair. */
    retainRuntimeBuffers?: boolean;
};

/** Close the outgoing native generation before any asynchronous retirement. */
export async function clearRuntimeCachedAudioBuffers(input: ClearRuntimeCachedAudioBuffersInput = {}): Promise<void> {
    const retirement = nativeTimelineMaterialOwner();
    try {
        if (!input.retainRuntimeBuffers) {
            clearRuntimeAudioBufferCache(input);
        }
    } finally {
        // Completion means the actual native fence and last PCM reader settled.
        // A failure stays visible to the committed transition or quiesce repair.
        await retirement;
    }
}
