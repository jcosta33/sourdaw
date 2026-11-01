import { agentRunStore } from '#/modules/AiRuntime/stores';
import { trackStore } from '#/modules/Arrangement/stores';
import { readUndoHistoryAudioBufferIds } from '#/modules/Arrangement/useCases';
import {
    configureDurableAudioBufferOwnership,
    configureLiveAudioBufferReferences,
} from '#/modules/AudioEngine/useCases';
import { collectDurableOwnedAudioBufferIds, collectTrackStateAudioBufferIds } from '#/modules/Project/useCases';

/** Temporary assets an agent run still owns: a prepared stem import keeps its
 * decoded buffer here from preparation until placement transfers it to the
 * arrangement or a discard releases it. */
function readAgentRunOwnedAssetIds(): string[] {
    return (agentRunStore.value?.runs ?? []).flatMap((run) =>
        run.temporaryAssets.filter((asset) => asset.status !== 'released').map((asset) => asset.assetId)
    );
}

/** Every buffer a synchronous playback or export read can still need. */
function readResidentAudioBufferIds(): string[] {
    return [
        ...collectTrackStateAudioBufferIds(trackStore.value),
        ...readUndoHistoryAudioBufferIds(),
        ...readAgentRunOwnedAssetIds(),
    ];
}

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
    // Undo and redo can bring a clip back (#6003), so whatever the history can
    // restore stays resident too, as does a prepared stem import awaiting placement.
    configureLiveAudioBufferReferences(readResidentAudioBufferIds);
}
