import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState, takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { addClip, createTrack, setTrackStoreState } from '#/modules/Arrangement/useCases';
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

import { renderToClip } from '../renderToClip';

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    cacheAudioBuffer: vi.fn(),
}));

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

describe('renderToClip take restore', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('render to clip take restore integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
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

    it('keeps a take on the rendered clip across undo, redo and undo, named by a live clip', async () => {
        const buffer = { length: 44100, numberOfChannels: 2, sampleRate: 44100 } as unknown as AudioBuffer;
        const rendered = renderToClip({
            targetTrackId: 'track-1',
            startBeat: 4,
            endBeat: 8,
            buffer,
            name: 'Rendered',
        });
        if (!rendered) {
            throw new Error('expected the rendered clip');
        }

        // A take naming the rendered clip, written with no local undo entry.
        const take = {
            id: 'take-on-render',
            clipId: rendered.clipId,
            name: 'Take on render',
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
        // Restoring the take is not enough: it has to name the clip that came back.
        expect(clipIdsNamedByLiveTakes()).toEqual([rendered.clipId]);
        expect(clipIds()).toEqual(expect.arrayContaining(clipIdsNamedByLiveTakes()));

        await undo();
        expect(clipIds()).toEqual(['clip-1']);
        expect(takeIdsInLiveLanes()).toEqual([]);
    });
});
