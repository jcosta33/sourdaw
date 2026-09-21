import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState, takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { addClip, createTrack, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { macroStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';

import { duplicateSelectedClipsForward } from '../duplicateSelectedClipsForward';

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function clipIds(): string[] {
    return (trackStore.value?.tracks[0]?.clips ?? []).map((clip) => clip.id);
}

function takeIdsInLiveLanes(): string[] {
    return (takeLaneStore.value?.lanes ?? []).flatMap((lane) => lane.takes.map((take) => take.id));
}

function clipIdsNamedByLiveTakes(): string[] {
    return (takeLaneStore.value?.lanes ?? []).flatMap((lane) => lane.takes.map((take) => take.clipId));
}

describe('duplicateSelectedClipsForward take restore', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('duplicate forward take restore integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        automationStore.set({ lanes: [] });
        setTrackStoreState({
            ...defaultTrackState,
            tracks: [createTrack({ id: 'track-1', name: 'Track 1', kind: 'audio' })],
            selectedTrackId: 'track-1',
        });
        addClip({ id: 'clip-1', trackId: 'track-1', startBeat: 0, endBeat: 4, name: 'Clip A', type: 'audio' });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        setTrackStoreState(structuredClone(defaultTrackState));
        takeLaneStore.set({ lanes: [] });
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('keeps a take on the copy across undo, redo and undo, named by a live clip', async () => {
        duplicateSelectedClipsForward(['clip-1']);
        const copyId = clipIds().find((id) => id !== 'clip-1');
        if (!copyId) {
            throw new Error('expected the duplicated copy');
        }

        // A take naming the copy, written with no local undo entry.
        const take = {
            id: 'take-on-copy',
            clipId: copyId,
            name: 'Take on copy',
            startBeat: 4,
            endBeat: 8,
            selected: false,
        };
        takeLaneStore.set({ lanes: [{ id: 'lane-1', trackId: 'track-1', takes: [take], activeCompRegions: [] }] });
        flushAutomergeStorageWrites();

        await undo();
        expect(clipIds()).toEqual(['clip-1']);
        expect(takeIdsInLiveLanes()).toEqual([]);

        await redo();
        expect(takeIdsInLiveLanes()).toEqual([take.id]);
        // Restoring the take is not enough: it has to name the copy that came back.
        expect(clipIdsNamedByLiveTakes()).toEqual([copyId]);
        expect(clipIds()).toEqual(expect.arrayContaining(clipIdsNamedByLiveTakes()));

        await undo();
        expect(clipIds()).toEqual(['clip-1']);
        expect(takeIdsInLiveLanes()).toEqual([]);
    });
});
