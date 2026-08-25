import { getAudioContext, prepareCachedAudioBuffersFromIdb } from '#/modules/AudioEngine/useCases';
import { clearUndoHistory } from '#/modules/Command/useCases';
import { stopPlayback } from '#/modules/Transport/useCases';

import { type ArrangementSnapshot, arrangementStore } from '../../stores/arrangementStore';
import { projectLoadEpoch } from '../projectPersistence/helpers/runProjectLoadTransaction';
import { markDirty } from '../projectPersistence/saveProject/markDirty';

import { loadSnapshot } from './loadSnapshot';
import { syncCurrentArrangementToStore } from './syncCurrentArrangementToStore';

let latestSwitchRequest = 0;

function collectArrangementBufferIds(snapshot: ArrangementSnapshot): string[] {
    const ids = new Set<string>();
    for (const track of snapshot.tracks.tracks) {
        const frozenBufferId = track.freezeState.frozenBufferId ?? track.frozenBufferId;
        if (frozenBufferId) {
            ids.add(frozenBufferId);
        }
        const clips = [...track.clips, ...track.alternatives.flatMap((alternative) => alternative.clips)];
        for (const clip of clips) {
            if (clip.audioBufferId) {
                ids.add(clip.audioBufferId);
            }
        }
    }
    return [...ids];
}

export async function switchArrangement(id: string): Promise<void> {
    const request = ++latestSwitchRequest;
    const state = arrangementStore.value;
    if (!state || state.activeArrangementId === id) {
        return;
    }

    const target = state.arrangements.find((alpha) => alpha.id === id);
    if (!target) {
        return;
    }

    const sourceProjectLoadEpoch = projectLoadEpoch.current;
    const sourceArrangementId = state.activeArrangementId;
    const preparedBuffers = await prepareCachedAudioBuffersFromIdb({
        audioContext: getAudioContext(),
        bufferIds: collectArrangementBufferIds(target),
        shouldContinue: () => request === latestSwitchRequest,
    });
    const currentState = arrangementStore.value;
    const currentTarget = currentState?.arrangements.find((arrangement) => arrangement.id === id);
    if (
        !preparedBuffers ||
        request !== latestSwitchRequest ||
        sourceProjectLoadEpoch !== projectLoadEpoch.current ||
        currentState?.activeArrangementId !== sourceArrangementId ||
        !currentTarget
    ) {
        preparedBuffers?.cancel();
        return;
    }

    // A shutdown failure aborts the switch before target buffers or state are published.
    try {
        await stopPlayback();
    } catch (error) {
        preparedBuffers.cancel();
        throw error;
    }

    const currentStateAfterStop = arrangementStore.value;
    const currentTargetAfterStop = currentStateAfterStop?.arrangements.find((arrangement) => arrangement.id === id);
    if (
        request !== latestSwitchRequest ||
        sourceProjectLoadEpoch !== projectLoadEpoch.current ||
        currentStateAfterStop?.activeArrangementId !== sourceArrangementId ||
        !currentTargetAfterStop
    ) {
        preparedBuffers.cancel();
        return;
    }

    preparedBuffers.publish();

    // Save current
    syncCurrentArrangementToStore();

    // Load target
    loadSnapshot(currentTargetAfterStop);

    // Clear undo history because IDs might have been reused or destroyed
    clearUndoHistory();

    arrangementStore.set({
        ...arrangementStore.value!,
        activeArrangementId: id,
    });

    markDirty();
}
