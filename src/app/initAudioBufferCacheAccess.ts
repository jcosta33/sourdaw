import { trackStore } from '#/modules/Arrangement/stores';
import {
    configureDurableAudioBufferOwnership,
    configureLiveAudioBufferReferences,
} from '#/modules/AudioEngine/useCases';
import { collectDurableOwnedAudioBufferIds, collectTrackStateAudioBufferIds } from '#/modules/Project/useCases';

/** Bind the audio cache's ownership and residency reads to the project that owns them. */
export function initAudioBufferCacheAccess(): void {
    // The audio-cache collectors pull the durable owned-id set at collection time
    // (issue #3777), so ordinary PCM a saved project still references survives the
    // age/budget sweeps while it is inactive. Enumeration stays a pull from the
    // persisted snapshots — no second ownership table to drift.
    configureDurableAudioBufferOwnership(collectDurableOwnedAudioBufferIds);
    // The runtime cache never evicts PCM the open arrangement references, so a take
    // recorded or a file imported after the project loaded keeps playing and
    // exporting while unrelated buffers (the first-launch factory seed) fill the LRU.
    configureLiveAudioBufferReferences(() => collectTrackStateAudioBufferIds(trackStore.value));
}
