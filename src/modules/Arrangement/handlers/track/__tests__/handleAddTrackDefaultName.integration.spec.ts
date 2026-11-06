import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState, trackStore } from '#/modules/Arrangement/stores';
import { createTrack, setArrangementEventBus, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    executeAppActionBatch,
    redo,
    registerProductionCommandHandlers,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import { shortcutStore } from '#/modules/CommandInterface/stores';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';

// Real production handlers, dispatch, CRDT authority and undo history: a
// nameless addTrack is named by the track owner, once, before it is recorded.

type ArrangementTrackEvents = {
    'track.added': { trackId: string; name: string; kind: string };
    'track.removed': { trackId: string };
    'track.selectionChanged': { trackId: string | null; previousTrackId: string | null };
};

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function trackNames(): string[] {
    return trackStore.value?.tracks.map((track) => track.name) ?? [];
}

function seedTracks(tracks: ReturnType<typeof createTrack>[]): void {
    setTrackStoreState({ ...defaultTrackState, tracks, selectedTrackId: tracks[0]?.id ?? null });
}

describe('addTrack default names', () => {
    beforeEach(() => {
        Container.clear();
        setArrangementEventBus(createEventBus<ArrangementTrackEvents>());
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('add track default name integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        seedTracks([
            createTrack({ id: 't-audio', name: 'Audio 1', kind: 'audio' }),
            createTrack({ id: 't-lead', name: 'Lead', kind: 'midi' }),
        ]);
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        setTrackStoreState(structuredClone(defaultTrackState));
        Container.clear();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('numbers nameless tracks per kind, ignoring other kinds and user names', async () => {
        await executeAppAction({ type: 'addTrack', payload: { kind: 'midi' } });
        await executeAppAction({ type: 'addTrack', payload: { kind: 'midi' } });
        await executeAppAction({ type: 'addTrack', payload: { kind: 'audio' } });

        expect(trackNames()).toEqual(['Audio 1', 'Lead', 'MIDI 1', 'MIDI 2', 'Audio 2']);
    });

    it('continues from the highest default number of the kind, counting a bare label as 1', async () => {
        seedTracks([
            createTrack({ id: 't-bare', name: 'MIDI', kind: 'midi' }),
            createTrack({ id: 't-three', name: 'MIDI 3', kind: 'midi' }),
            createTrack({ id: 't-audio-named-midi', name: 'MIDI 9', kind: 'audio' }),
            createTrack({ id: 't-two', name: 'MIDI 2', kind: 'midi' }),
        ]);

        await executeAppAction({ type: 'addTrack', payload: { kind: 'midi' } });
        await executeAppAction({ type: 'addTrack', payload: { kind: 'audio' } });

        expect(trackNames().slice(4)).toEqual(['MIDI 4', 'Audio 1']);
    });

    it('keeps an explicit name verbatim', async () => {
        await executeAppAction({ type: 'addTrack', payload: { name: 'MIDI 1', kind: 'midi' } });
        await executeAppAction({ type: 'addTrack', payload: { name: 'Kick', kind: 'midi' } });

        expect(trackNames().slice(2)).toEqual(['MIDI 1', 'Kick']);
    });

    it('gives nameless tracks in one batch distinct consecutive names', async () => {
        const result = await executeAppActionBatch([
            { type: 'addTrack', payload: { kind: 'midi' } },
            { type: 'addTrack', payload: { name: 'Pad', kind: 'midi' } },
            { type: 'addTrack', payload: { kind: 'midi' } },
            { type: 'addTrack', payload: { kind: 'bus' } },
        ]);

        expect(result.status).toBe('committed');
        expect(trackNames().slice(2)).toEqual(['MIDI 1', 'Pad', 'MIDI 2', 'Bus 1']);
    });

    it('restores the recorded name on redo even after the project gained a higher number', async () => {
        await executeAppAction({ type: 'addTrack', payload: { kind: 'midi' } });
        const created = trackStore.value?.tracks.at(-1);
        expect(created?.name).toBe('MIDI 1');

        await undo();
        expect(trackNames()).toEqual(['Audio 1', 'Lead']);
        // A collaborator's track arrives between undo and redo; a recomputed
        // name would now be "MIDI 5".
        const state = trackStore.value ?? defaultTrackState;
        setTrackStoreState({
            ...state,
            tracks: [...state.tracks, createTrack({ id: 't-remote', name: 'MIDI 4', kind: 'midi' })],
        });

        await redo();

        const restored = trackStore.value?.tracks.find((track) => track.id === created?.id);
        expect(restored?.name).toBe('MIDI 1');
    });

    it('names each press of the New MIDI Track shortcut differently', async () => {
        const definition = shortcutStore.value?.definitions.find(
            (candidate) => candidate.id === 'arrangement.addMidiTrack'
        );
        if (definition?.action.type !== 'appAction') {
            throw new Error('Expected the New MIDI Track shortcut to dispatch an app action');
        }

        await executeAppAction(definition.action.action);
        await executeAppAction(definition.action.action);

        expect(trackNames().slice(2)).toEqual(['MIDI 1', 'MIDI 2']);
    });
});
