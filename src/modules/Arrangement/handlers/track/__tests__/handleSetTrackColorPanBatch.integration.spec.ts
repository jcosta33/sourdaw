import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import * as automergeStorage from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState, trackStore } from '#/modules/Arrangement/stores';
import { createTrack, setArrangementEventBus, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppActionBatch,
    redo,
    registerProductionCommandHandlers,
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

// Real production handlers, dispatch, CRDT authority and undo history: the
// batch describes every action before executing any, so a colour or pan edit
// must record its inverse from the batch plan, not from the pre-batch store.

type ArrangementTrackEvents = {
    'track.removed': { trackId: string };
    'track.selectionChanged': { trackId: string | null; previousTrackId: string | null };
};

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

const GROUP = { groupId: 'colour-pan-batch', groupLabel: 'Edit track' };

function storedTrack(trackId: string) {
    return trackStore.value?.tracks.find((track) => track.id === trackId);
}

describe('track colour and pan edits inside one batch', () => {
    beforeEach(() => {
        Container.clear();
        setArrangementEventBus(createEventBus<ArrangementTrackEvents>());
        automergeStorage.configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('colour pan batch integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        const existing = { ...createTrack({ id: 't-existing', name: 'Audio 1', kind: 'audio' }), color: '#aa0000' };
        setTrackStoreState({ ...defaultTrackState, tracks: [existing], selectedTrackId: existing.id });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        setTrackStoreState(structuredClone(defaultTrackState));
        Container.clear();
        automergeStorage.configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('undoes and redoes a colour set on a track the same batch adds', async () => {
        const result = await executeAppActionBatch(
            [
                { type: 'addTrack', payload: { id: 't-new', kind: 'audio' } },
                { type: 'setTrackColor', payload: { trackId: 't-new', color: '#00ff00' } },
            ],
            GROUP
        );

        expect(result.status).toBe('committed');
        expect(storedTrack('t-new')?.color).toBe('#00ff00');

        await undo();
        expect(storedTrack('t-new')).toBeUndefined();

        await redo();
        expect(storedTrack('t-new')?.color).toBe('#00ff00');
    });

    it('undoes and redoes a pan set on a track the same batch adds', async () => {
        const result = await executeAppActionBatch(
            [
                { type: 'addTrack', payload: { id: 't-new', kind: 'audio' } },
                { type: 'setTrackPan', payload: { trackId: 't-new', pan: 0.5, expectedPan: 0 } },
            ],
            GROUP
        );

        expect(result.status).toBe('committed');
        expect(storedTrack('t-new')?.pan).toBe(0.5);

        await undo();
        expect(storedTrack('t-new')).toBeUndefined();

        await redo();
        expect(storedTrack('t-new')?.pan).toBe(0.5);
    });

    it('undoes two colour edits of one track back to the original and redoes to the last', async () => {
        const result = await executeAppActionBatch(
            [
                { type: 'setTrackColor', payload: { trackId: 't-existing', color: '#00ff00' } },
                { type: 'setTrackColor', payload: { trackId: 't-existing', color: '#0000ff' } },
            ],
            GROUP
        );

        expect(result.status).toBe('committed');
        expect(storedTrack('t-existing')?.color).toBe('#0000ff');

        await undo();
        expect(storedTrack('t-existing')?.color).toBe('#aa0000');

        await redo();
        expect(storedTrack('t-existing')?.color).toBe('#0000ff');
    });

    it('undoes two pan edits of one track back to the original and redoes to the last', async () => {
        const result = await executeAppActionBatch(
            [
                { type: 'setTrackPan', payload: { trackId: 't-existing', pan: 0.5, expectedPan: 0 } },
                { type: 'setTrackPan', payload: { trackId: 't-existing', pan: -0.5, expectedPan: 0.5 } },
            ],
            GROUP
        );

        expect(result.status).toBe('committed');
        expect(storedTrack('t-existing')?.pan).toBe(-0.5);

        await undo();
        expect(storedTrack('t-existing')?.pan).toBe(0);

        await redo();
        expect(storedTrack('t-existing')?.pan).toBe(-0.5);
    });
});
