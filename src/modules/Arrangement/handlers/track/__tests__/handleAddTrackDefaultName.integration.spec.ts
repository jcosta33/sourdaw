import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import * as automergeStorage from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState, trackStore } from '#/modules/Arrangement/stores';
import { createTrack, setArrangementEventBus, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry } from '#/modules/Command/stores';
import {
    captureUndoHistory,
    clearUndoHistory,
    executeAppAction,
    executeAppActionBatch,
    executeUserAppAction,
    redo,
    registerProductionCommandHandlers,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import { shortcutStore } from '#/modules/CommandInterface/stores';
import {
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    transactSnapshot,
} from '#/modules/CrdtDocument/useCases';
import { type AppAction } from '#/utils/handlerContract';

// Real production handlers, dispatch, CRDT authority and undo history: a
// nameless addTrack is named by the track owner, once, before it is recorded.

type ArrangementTrackEvents = {
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
        automergeStorage.configureAutomergeStoragePort(null);
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
        automergeStorage.configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('numbers nameless tracks per kind, ignoring other kinds and user names', async () => {
        await executeAppAction({ type: 'addTrack', payload: { kind: 'midi' } });
        await executeAppAction({ type: 'addTrack', payload: { kind: 'midi' } });
        await executeAppAction({ type: 'addTrack', payload: { kind: 'audio' } });

        expect(trackNames()).toEqual(['Audio 1', 'Lead', 'MIDI 1', 'MIDI 2', 'Audio 2']);
    });

    it('numbers overlapping nameless UI additions after both wait at a real snapshot transaction', async () => {
        automergeStorage.flushAutomergeStorageWrites();
        const entered = Promise.withResolvers<void>();
        const held = Promise.withResolvers<void>();
        const firstWaiting = Promise.withResolvers<void>();
        const secondWaiting = Promise.withResolvers<void>();
        const waitForSnapshot = automergeStorage.waitForAutomergeSnapshotTransaction;
        let admissions = 0;
        const waitSpy = vi
            .spyOn(automergeStorage, 'waitForAutomergeSnapshotTransaction')
            .mockImplementation((transaction) => {
                admissions += 1;
                if (admissions === 1) {
                    firstWaiting.resolve();
                } else if (admissions === 2) {
                    secondWaiting.resolve();
                }
                return waitForSnapshot(transaction);
            });
        const snapshotTransaction = transactSnapshot(async () => {
            entered.resolve();
            await held.promise;
        });
        await entered.promise;
        let commands: Promise<void>[] = [];
        try {
            commands = [
                executeUserAppAction({ type: 'addTrack', payload: { kind: 'midi' } }),
                executeUserAppAction({ type: 'addTrack', payload: { kind: 'midi' } }),
            ];
            await Promise.all([firstWaiting.promise, secondWaiting.promise]);
        } finally {
            held.resolve();
            await Promise.allSettled([snapshotTransaction, ...commands]);
            waitSpy.mockRestore();
        }
        await snapshotTransaction;
        await Promise.all(commands);

        const created = trackStore.value?.tracks.slice(2) ?? [];
        expect(created).toHaveLength(2);
        expect(new Set(created.map((track) => track.id)).size).toBe(2);
        const raw = getCrdtDoc<{ tracks: Pick<NonNullable<typeof trackStore.value>, 'tracks'> }>('root');
        expect(raw?.tracks.tracks).toEqual(trackStore.value?.tracks);
        const history = captureUndoHistory();
        expect(history.past).toHaveLength(2);
        expect(history.future).toEqual([]);
        const recorded = history.past.map((entry) => {
            if (entry.kind !== 'action' || entry.action.type !== 'addTrack') {
                throw new Error('Expected an actual addTrack history entry for each UI request');
            }
            return { id: entry.action.payload.id, name: entry.action.payload.name };
        });
        expect(recorded).toEqual(created.map(({ id, name }) => ({ id, name })));
        expect(created.map((track) => track.name)).toEqual(['MIDI 1', 'MIDI 2']);

        const committedTracks = structuredClone(trackStore.value?.tracks ?? []);
        await undo();
        expect(trackStore.value?.tracks).toEqual(committedTracks.slice(0, 3));
        await undo();
        expect(trackStore.value?.tracks).toEqual(committedTracks.slice(0, 2));
        await redo();
        expect(trackStore.value?.tracks).toEqual(committedTracks.slice(0, 3));
        await redo();
        expect(trackStore.value?.tracks).toEqual(committedTracks);
        await undo();
        expect(trackStore.value?.tracks).toEqual(committedTracks.slice(0, 3));
        const replayedRaw = getCrdtDoc<{ tracks: Pick<NonNullable<typeof trackStore.value>, 'tracks'> }>('root');
        expect(replayedRaw?.tracks.tracks).toEqual(trackStore.value?.tracks);
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

    it.each(['remove', 'rename'] as const)(
        'names an addition from the actual %s prefix and replays the batch',
        async (change) => {
            const first = createTrack({ id: 'audio-1', name: 'Audio 1', kind: 'audio' });
            let prior: AppAction;
            let expected: string[];
            if (change === 'remove') {
                seedTracks([first, createTrack({ id: 'audio-2', name: 'Audio 2', kind: 'audio' })]);
                prior = { type: 'removeTrack', payload: { trackId: 'audio-2' } };
                expected = ['Audio 1', 'Audio 2'];
            } else {
                seedTracks([first]);
                prior = { type: 'renameTrack', payload: { trackId: first.id, name: 'Drums' } };
                expected = ['Drums', 'Audio 1'];
            }
            const before = structuredClone(trackStore.value?.tracks ?? []);
            const beforeIds = new Set(before.map((track) => track.id));
            const result = await executeAppActionBatch([prior, { type: 'addTrack', payload: { kind: 'audio' } }], {
                groupId: 'ordered-track-names',
                groupLabel: 'Edit and add track',
            });

            expect(result.status).toBe('committed');
            const created = trackStore.value?.tracks.filter((track) => !beforeIds.has(track.id)) ?? [];
            expect(created).toHaveLength(1);
            const raw = getCrdtDoc<{ tracks: Pick<NonNullable<typeof trackStore.value>, 'tracks'> }>('root');
            expect(raw?.tracks.tracks).toEqual(trackStore.value?.tracks);
            const history = captureUndoHistory();
            expect(history.past).toHaveLength(2);
            expect(history.future).toEqual([]);
            expect(history.past[0]?.groupId).toBe(history.past[1]?.groupId);
            const added = history.past[1];
            if (added?.kind !== 'action' || added.action.type !== 'addTrack') {
                throw new Error('Expected the real batch to record its materialized addition');
            }
            expect(added.action.payload).toMatchObject({ id: created[0]?.id, name: created[0]?.name });
            expect(trackNames()).toEqual(expected);

            const committed = structuredClone(trackStore.value?.tracks ?? []);
            await undo();
            expect(trackStore.value?.tracks).toEqual(before);
            await redo();
            expect(trackStore.value?.tracks).toEqual(committed);
            await undo();
            expect(trackStore.value?.tracks).toEqual(before);
            const replayed = getCrdtDoc<{ tracks: Pick<NonNullable<typeof trackStore.value>, 'tracks'> }>('root');
            expect(replayed?.tracks.tracks).toEqual(trackStore.value?.tracks);
        }
    );

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
