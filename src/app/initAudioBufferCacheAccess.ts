import { agentRunStore } from '#/modules/AiRuntime/stores';
import { trackStore } from '#/modules/Arrangement/stores';
import { readUndoEntriesAudioBufferIds, readUndoHistoryAudioBufferIds } from '#/modules/Arrangement/useCases';
import {
    configureDurableAudioBufferOwnership,
    configureHistoryAudioBufferReferences,
    configureLiveAudioBufferReferences,
    prepareCachedAudioBuffersForReplay,
} from '#/modules/AudioEngine/useCases';
import { undoReplayPreparationPort } from '#/modules/Command/useCases';
import { collectDurableOwnedAudioBufferIds, collectTrackStateAudioBufferIds } from '#/modules/Project/useCases';

/** Temporary assets an agent run still owns: a prepared stem import keeps its
 * decoded buffer here from preparation until placement transfers it to the
 * arrangement or a discard releases it. */
function readAgentRunOwnedAssetIds(): string[] {
    return (agentRunStore.value?.runs ?? []).flatMap((run) =>
        run.temporaryAssets.filter((asset) => asset.status !== 'released').map((asset) => asset.assetId)
    );
}

/** Every buffer a synchronous playback or export read can need right now. */
function readLiveAudioBufferIds(): string[] {
    return [...collectTrackStateAudioBufferIds(trackStore.value), ...readAgentRunOwnedAssetIds()];
}

/** Saved projects and the open one own their PCM durably; so does the undo
 * history, whose replays rehydrate evicted buffers from that storage. */
async function collectDurableAndHistoryOwnedAudioBufferIds(): Promise<{
    ids: readonly string[];
    isCurrent: () => boolean;
}> {
    const census = await collectDurableOwnedAudioBufferIds();
    return { ids: [...census.ids, ...readUndoHistoryAudioBufferIds()], isCurrent: census.isCurrent };
}

/** Bind the audio cache's ownership and residency reads to the project that owns them. */
export function initAudioBufferCacheAccess(): void {
    // The audio-cache collectors pull the durable owned-id set at collection time
    // (issue #3777), so ordinary PCM a saved project still references survives the
    // age/budget sweeps while it is inactive. Enumeration stays a pull from the
    // persisted snapshots — no second ownership table to drift.
    configureDurableAudioBufferOwnership(collectDurableAndHistoryOwnedAudioBufferIds);
    // The runtime cache never evicts PCM the open arrangement references, so a take
    // recorded or a file imported after the project loaded keeps playing and
    // exporting while unrelated buffers (the first-launch factory seed) fill the LRU.
    configureLiveAudioBufferReferences(readLiveAudioBufferIds);
    // Undo and redo can bring a clip back (#6003). The history has no cap, so its
    // buffers stay only until their PCM is durable, and each replay rehydrates and
    // holds what its entries name before it applies.
    configureHistoryAudioBufferReferences(readUndoHistoryAudioBufferIds);
    undoReplayPreparationPort.setProvider((entries) =>
        prepareCachedAudioBuffersForReplay([...readUndoEntriesAudioBufferIds(entries)])
    );
}
