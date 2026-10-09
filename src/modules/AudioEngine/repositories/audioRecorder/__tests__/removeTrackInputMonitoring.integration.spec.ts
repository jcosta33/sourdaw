import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initInputMonitoringProjectAccess } from '#/app/initInputMonitoringProjectAccess';
import {
    configureAutomergeStoragePort,
    createAutomergeStoragePreview,
    flushAutomergeStorageWrites,
    runWithAutomergeStorageTransaction,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';
import { createTrack, getArrangementHandlers, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import {
    configureInputMonitoringProjectAccess,
    startInputMonitoring,
    stopInputMonitoring,
    syncAutoInputMonitoring,
} from '#/modules/AudioEngine/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction, undo } from '#/modules/Command/useCases';
import { createCrdtDoc, getCrdtDoc, mutateCrdtDoc, removeCrdtDoc } from '#/modules/CrdtDocument/useCases';

import { inputMonitoringSession } from '../inputMonitoringSession';

const engine = vi.hoisted(() => ({
    createMediaStreamSource: vi.fn(),
    ensureTrackStrip: vi.fn(),
    removeTrackStrip: vi.fn(),
    initializeTrackStripFromSnapshot: vi.fn(),
    setTrackGain: vi.fn(),
    setTrackPan: vi.fn(),
    setTrackMute: vi.fn(),
    setTrackSoloGate: vi.fn(),
}));

const getUserMedia = vi.fn<() => Promise<{ getTracks: () => Array<{ stop: () => void }> }>>();

vi.mock('../../createWebAudioEngine', () => ({
    audioEngine: {
        context: { createMediaStreamSource: engine.createMediaStreamSource },
        ensureTrackStrip: engine.ensureTrackStrip,
        initializeTrackStripFromSnapshot: engine.initializeTrackStripFromSnapshot,
        setTrackGain: engine.setTrackGain,
        setTrackPan: engine.setTrackPan,
        setTrackMute: engine.setTrackMute,
        setTrackSoloGate: engine.setTrackSoloGate,
        getRuntimeGraphRevision: () => 0,
    },
}));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    removeTrackStrip: engine.removeTrackStrip,
}));

function deferredGrant() {
    let grant: (stream: { getTracks: () => Array<{ stop: () => void }> }) => void = () => {
        throw new Error('Capture request was not started');
    };
    const request = new Promise<{ getTracks: () => Array<{ stop: () => void }> }>((resolve) => {
        grant = resolve;
    });
    return { request, grant };
}

describe('track deletion releases the input monitor at Command commit', () => {
    const originalMediaDevices = globalThis.navigator.mediaDevices;
    const source = { connect: vi.fn(), disconnect: vi.fn() };
    const inputTrack = { stop: vi.fn() };
    const stream = { getTracks: vi.fn(() => [inputTrack]) };
    const gains = new Map([
        ['a', { id: 'gain-a' }],
        ['b', { id: 'gain-b' }],
    ]);
    const commitRefusal = new Error('Refused track transaction');
    let refuseCommit: boolean;
    let failAfterPublication: boolean;
    let docTrackIdsAtConnect: string[][];
    let docTrackIdsAtStop: string[];
    let docTrackIdsAtDisconnect: string[][];
    let unsubscribe: (() => void) | undefined;

    function docTrackIds(): string[] {
        const doc = getCrdtDoc('root');
        if (!doc) {
            throw new Error('Expected a registered committed root');
        }
        const slot = doc.tracks;
        if (!slot || typeof slot !== 'object' || !('tracks' in slot) || !Array.isArray(slot.tracks)) {
            throw new Error('Expected committed tracks in the document');
        }
        return slot.tracks.map((track: { id: string }) => track.id);
    }

    function liveTrackIds(): string[] {
        return trackStore.value?.tracks.map((track) => track.id) ?? [];
    }

    function monitorOwners(): string[] {
        return [...inputMonitoringSession.trackKeys.keys()].sort();
    }

    beforeEach(() => {
        configureAutomergeStoragePort(null);
        stopInputMonitoring();
        vi.clearAllMocks();
        getUserMedia.mockReset();
        createCrdtDoc('root');
        refuseCommit = false;
        failAfterPublication = false;
        docTrackIdsAtConnect = [];
        docTrackIdsAtStop = [];
        docTrackIdsAtDisconnect = [];
        clearHandlerRegistry();
        const handlers = getArrangementHandlers();
        registerHandlerMap({
            removeTrack: handlers.removeTrack,
            removeAllTracks: handlers.removeAllTracks,
            restoreTrack: handlers.restoreTrack,
            restoreTracks: handlers.restoreTracks,
        });
        clearUndoHistory();
        setArrangementEventBus({ emit: async () => undefined });
        configureAutomergeStoragePort({
            getDoc: (id) => getCrdtDoc(id),
            getSemanticMessage: () => undefined,
            hasDoc: (id) => getCrdtDoc(id) !== undefined,
            mutateDoc: ({ docId, changeFn, message, snapshotTransaction, changedKeys }) => {
                if (refuseCommit) {
                    throw commitRefusal;
                }
                mutateCrdtDoc({ id: docId, changeFn, message, snapshotTransaction, localSlots: changedKeys });
                if (failAfterPublication) {
                    throw commitRefusal;
                }
            },
        });
        trackStore.set({
            tracks: [
                {
                    ...createTrack({ id: 'a', name: 'Audio A', kind: 'audio', withoutDefaultDevice: true }),
                    inputMonitoring: 'on',
                },
                {
                    ...createTrack({ id: 'b', name: 'Audio B', kind: 'audio', withoutDefaultDevice: true }),
                    inputMonitoring: 'on',
                },
            ],
            selectedTrackId: null,
            ghostClips: [],
        });
        flushAutomergeStorageWrites();
        getUserMedia.mockResolvedValue(stream);
        engine.createMediaStreamSource.mockReturnValue(source);
        engine.ensureTrackStrip.mockImplementation((trackId: string) => ({ gainNode: gains.get(trackId) }));
        inputTrack.stop.mockImplementation(() => {
            docTrackIdsAtStop = docTrackIds();
        });
        engine.initializeTrackStripFromSnapshot.mockReturnValue({ acceptance: 'accepted', application: 'applied' });
        source.connect.mockImplementation(() => {
            docTrackIdsAtConnect.push(docTrackIds());
        });
        source.disconnect.mockImplementation(() => {
            docTrackIdsAtDisconnect.push(docTrackIds());
        });
        Object.defineProperty(globalThis.navigator, 'mediaDevices', {
            value: { getUserMedia },
            configurable: true,
        });
        initInputMonitoringProjectAccess();
        unsubscribe = syncAutoInputMonitoring();
    });

    afterEach(() => {
        refuseCommit = false;
        failAfterPublication = false;
        unsubscribe?.();
        unsubscribe = undefined;
        configureInputMonitoringProjectAccess(null);
        stopInputMonitoring();
        clearUndoHistory();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        Object.defineProperty(globalThis.navigator, 'mediaDevices', {
            value: originalMediaDevices,
            configurable: true,
        });
    });

    it('retains both owners after a refused single delete, then releases only committed owners', async () => {
        await startInputMonitoring('a', null);
        await startInputMonitoring('b', null);
        source.disconnect.mockClear();

        refuseCommit = true;
        await expect(executeAppAction({ type: 'removeTrack', payload: { trackId: 'a' } })).rejects.toBe(commitRefusal);
        refuseCommit = false;
        expect(docTrackIds()).toEqual(['a', 'b']);
        expect(liveTrackIds()).toEqual(['a', 'b']);
        expect(monitorOwners()).toEqual(['a', 'b']);
        expect(source.disconnect).not.toHaveBeenCalled();
        expect(docTrackIdsAtDisconnect).toEqual([]);
        expect(inputTrack.stop).not.toHaveBeenCalled();

        await executeAppAction({ type: 'removeTrack', payload: { trackId: 'a' } });
        expect(docTrackIds()).toEqual(['b']);
        expect(liveTrackIds()).toEqual(['b']);
        expect(monitorOwners()).toEqual(['b']);
        expect(source.disconnect).toHaveBeenCalledWith(gains.get('a'));
        expect(source.disconnect).not.toHaveBeenCalledWith(gains.get('b'));
        expect(docTrackIdsAtDisconnect).toEqual([['b']]);
        expect(inputTrack.stop).not.toHaveBeenCalled();

        await executeAppAction({ type: 'removeTrack', payload: { trackId: 'b' } });
        expect(docTrackIds()).toEqual([]);
        expect(liveTrackIds()).toEqual([]);
        expect(source.disconnect).toHaveBeenCalledWith(gains.get('b'));
        expect(inputTrack.stop).toHaveBeenCalledOnce();
        expect(docTrackIdsAtStop).toEqual([]);
        expect(docTrackIdsAtDisconnect.every((ids) => !ids.includes('a'))).toBe(true);
        expect(docTrackIdsAtDisconnect.slice(1).every((ids) => !ids.includes('b'))).toBe(true);
    });

    it('retains both owners after a refused bulk delete and releases both after commit', async () => {
        await startInputMonitoring('a', null);
        await startInputMonitoring('b', null);
        source.disconnect.mockClear();

        refuseCommit = true;
        await expect(executeAppAction({ type: 'removeAllTracks', payload: undefined })).rejects.toBe(commitRefusal);
        refuseCommit = false;
        expect(docTrackIds()).toEqual(['a', 'b']);
        expect(liveTrackIds()).toEqual(['a', 'b']);
        expect(monitorOwners()).toEqual(['a', 'b']);
        expect(source.disconnect).not.toHaveBeenCalled();
        expect(docTrackIdsAtDisconnect).toEqual([]);
        expect(inputTrack.stop).not.toHaveBeenCalled();

        await executeAppAction({ type: 'removeAllTracks', payload: undefined });
        expect(docTrackIds()).toEqual([]);
        expect(liveTrackIds()).toEqual([]);
        expect(monitorOwners()).toEqual([]);
        expect(source.disconnect).toHaveBeenCalledWith(gains.get('a'));
        expect(source.disconnect).toHaveBeenCalledWith(gains.get('b'));
        expect(inputTrack.stop).toHaveBeenCalledOnce();
        expect(docTrackIdsAtStop).toEqual([]);
        expect(docTrackIdsAtDisconnect).toEqual([[], [], []]);
    });

    it.each([
        ['removeTrack', 'audio'],
        ['removeAllTracks', 'audio'],
        ['removeTrack', 'midi'],
    ] as const)('restores committed On capture after real Command Undo of %s for %s tracks', async (type, kind) => {
        if (kind === 'midi') {
            const state = trackStore.value;
            if (!state) {
                throw new Error('Expected tracks before changing their kind');
            }
            trackStore.set({ ...state, tracks: state.tracks.map((track) => ({ ...track, kind })) });
            flushAutomergeStorageWrites();
        }
        const restoredInputTrack = { stop: vi.fn() };
        const restoredStream = { getTracks: () => [restoredInputTrack] };
        const restoredSource = { connect: vi.fn(), disconnect: vi.fn() };
        const restoredConnect = type === 'removeTrack' ? source.connect : restoredSource.connect;
        if (type === 'removeAllTracks') {
            getUserMedia.mockResolvedValueOnce(stream).mockResolvedValueOnce(restoredStream);
            engine.createMediaStreamSource.mockImplementation((capturedStream) =>
                capturedStream === restoredStream ? restoredSource : source
            );
            restoredSource.connect.mockImplementation(() => {
                docTrackIdsAtConnect.push(docTrackIds());
            });
        }
        await startInputMonitoring('a', null);
        await startInputMonitoring('b', null);
        const action = type === 'removeTrack' ? { type, payload: { trackId: 'a' } } : { type, payload: undefined };
        await executeAppAction(action);
        expect(monitorOwners()).toEqual(type === 'removeTrack' ? ['b'] : []);
        source.connect.mockClear();
        docTrackIdsAtConnect = [];

        await undo();

        expect(docTrackIds()).toEqual(['a', 'b']);
        expect(liveTrackIds()).toEqual(['a', 'b']);
        expect(trackStore.value?.tracks.map((track) => track.inputMonitoring)).toEqual(['on', 'on']);
        expect(monitorOwners()).toEqual(['a', 'b']);
        expect(restoredConnect).toHaveBeenCalledWith(gains.get('a'));
        expect(docTrackIdsAtConnect.every((ids) => ids.includes('a') && ids.includes('b'))).toBe(true);
        expect(engine.initializeTrackStripFromSnapshot.mock.invocationCallOrder[0]).toBeLessThan(
            restoredConnect.mock.invocationCallOrder[0]!
        );
        expect(getUserMedia).toHaveBeenCalledTimes(type === 'removeTrack' ? 1 : 2);
        expect(inputTrack.stop).toHaveBeenCalledTimes(type === 'removeTrack' ? 0 : 1);
        if (type === 'removeTrack') {
            expect(source.connect).not.toHaveBeenCalledWith(gains.get('b'));
        } else {
            expect(restoredConnect).toHaveBeenCalledWith(gains.get('b'));
            expect(engine.createMediaStreamSource).toHaveBeenLastCalledWith(restoredStream);
            expect(restoredInputTrack.stop).not.toHaveBeenCalled();
        }
        expect(
            getCrdtDoc<{ tracks: { tracks: Array<{ inputMonitoring: string }> } }>('root')?.tracks.tracks.map(
                (track) => track.inputMonitoring
            )
        ).toEqual(['on', 'on']);
    });

    it('does not acquire capture for a refused restore or an isolated preview', async () => {
        await startInputMonitoring('a', null);
        await executeAppAction({ type: 'removeTrack', payload: { trackId: 'a' } });
        const entry = undoHistoryStore.value?.past.at(-1);
        if (!entry || entry.kind !== 'action' || entry.inverseAction?.type !== 'restoreTrack') {
            throw new Error('Expected the real track deletion inverse');
        }
        getUserMedia.mockClear();
        source.connect.mockClear();
        engine.initializeTrackStripFromSnapshot.mockClear();
        const document = getCrdtDoc('root');
        if (!document) {
            throw new Error('Expected committed document for preview');
        }
        const inverseAction = entry.inverseAction;
        const preview = createAutomergeStoragePreview(new Map([['root', document]]));
        try {
            preview.scope(() => {
                const result = getArrangementHandlers().restoreTrack.execute(inverseAction);
                expect(result).toMatchObject({ status: 'written' });
                expect(liveTrackIds()).toEqual(['a', 'b']);
            });
        } finally {
            preview.release();
        }
        expect(docTrackIds()).toEqual(['b']);
        expect(liveTrackIds()).toEqual(['b']);
        expect(getUserMedia).not.toHaveBeenCalled();
        expect(source.connect).not.toHaveBeenCalled();
        expect(engine.initializeTrackStripFromSnapshot).not.toHaveBeenCalled();

        refuseCommit = true;
        await expect(executeAppAction(entry.inverseAction)).rejects.toBe(commitRefusal);
        refuseCommit = false;
        expect(docTrackIds()).toEqual(['b']);
        expect(liveTrackIds()).toEqual(['b']);
        expect(monitorOwners()).toEqual([]);
        expect(getUserMedia).not.toHaveBeenCalled();
        expect(source.connect).not.toHaveBeenCalled();
    });

    it('rearms the actually published owner after an ambiguous restore commit', async () => {
        await startInputMonitoring('a', null);
        await startInputMonitoring('b', null);
        await executeAppAction({ type: 'removeTrack', payload: { trackId: 'a' } });
        const entry = undoHistoryStore.value?.past.at(-1);
        if (!entry || entry.kind !== 'action' || entry.inverseAction?.type !== 'restoreTrack') {
            throw new Error('Expected the real track deletion inverse');
        }
        source.connect.mockClear();
        failAfterPublication = true;
        await expect(executeAppAction(entry.inverseAction)).rejects.toThrow();
        failAfterPublication = false;
        expect(docTrackIds()).toEqual(['a', 'b']);
        expect(liveTrackIds()).toEqual(['a', 'b']);
        expect(monitorOwners()).toEqual(['a', 'b']);
        expect(source.connect).toHaveBeenCalledExactlyOnceWith(gains.get('a'));
        expect(getUserMedia).toHaveBeenCalledTimes(1);
        expect(inputTrack.stop).not.toHaveBeenCalled();
    });

    it('keeps restored document truth and Undo success when microphone acquisition is denied', async () => {
        await startInputMonitoring('a', null);
        await startInputMonitoring('b', null);
        await executeAppAction({ type: 'removeAllTracks', payload: undefined });
        getUserMedia.mockRejectedValue(new Error('Microphone denied'));

        await expect(undo()).resolves.toEqual({ headConsumed: true });

        expect(docTrackIds()).toEqual(['a', 'b']);
        expect(liveTrackIds()).toEqual(['a', 'b']);
        expect(trackStore.value?.tracks.map((track) => track.inputMonitoring)).toEqual(['on', 'on']);
        expect(monitorOwners()).toEqual([]);
        expect(undoHistoryStore.value?.past).toEqual([]);
    });

    it('does not reconnect or recreate a deleted strip when permission arrives after commit', async () => {
        const pending = deferredGrant();
        getUserMedia.mockReturnValue(pending.request);
        const starting = startInputMonitoring('a', null);

        await executeAppAction({ type: 'removeTrack', payload: { trackId: 'a' } });
        expect(docTrackIds()).toEqual(['b']);
        expect(monitorOwners()).toEqual([]);
        pending.grant(stream);

        expect(await starting).toBe(false);
        expect(engine.ensureTrackStrip).not.toHaveBeenCalled();
        expect(engine.createMediaStreamSource).not.toHaveBeenCalled();
        expect(inputTrack.stop).toHaveBeenCalledOnce();
    });

    it.each(['removeTrack', 'removeAllTracks'] as const)(
        'keeps the subscribed Auto capture after a refused %s',
        async (type) => {
            const state = trackStore.value;
            if (!state) {
                throw new Error('Expected tracks before Auto admission');
            }
            trackStore.set({
                ...state,
                tracks: state.tracks.map((track) => ({ ...track, armed: true, inputMonitoring: 'auto' })),
            });
            flushAutomergeStorageWrites();
            await startInputMonitoring('a', null);
            await startInputMonitoring('b', null);
            expect(getUserMedia).toHaveBeenCalledTimes(1);
            source.disconnect.mockClear();
            docTrackIdsAtDisconnect = [];

            refuseCommit = true;
            const action = type === 'removeTrack' ? { type, payload: { trackId: 'a' } } : { type, payload: undefined };
            await expect(executeAppAction(action)).rejects.toBe(commitRefusal);
            refuseCommit = false;

            expect(docTrackIds()).toEqual(['a', 'b']);
            expect(liveTrackIds()).toEqual(['a', 'b']);
            expect(monitorOwners()).toEqual(['a', 'b']);
            expect(source.disconnect).not.toHaveBeenCalled();
            expect(docTrackIdsAtDisconnect).toEqual([]);
            expect(inputTrack.stop).not.toHaveBeenCalled();
            expect(getUserMedia).toHaveBeenCalledTimes(1);
        }
    );

    it('preserves an unflushed direct On through an unrelated owned track publication', async () => {
        const state = trackStore.value;
        if (!state) {
            throw new Error('Expected track state');
        }
        trackStore.set({ ...state, tracks: state.tracks.map((track) => ({ ...track, inputMonitoring: 'off' })) });
        flushAutomergeStorageWrites();
        const transaction = runWithAutomergeStorageTransaction(undefined, () => {
            trackStore.set({ ...state, tracks: state.tracks.map((track) => ({ ...track, inputMonitoring: 'on' })) });
            const starting = startInputMonitoring('a', null);
            trackStore.update(
                (current) =>
                    current && {
                        ...current,
                        tracks: current.tracks.map((track) =>
                            track.id === 'b' ? { ...track, name: 'Renamed B' } : track
                        ),
                    }
            );
            return starting;
        });
        if (transaction.status === 'threw') {
            throw transaction.error;
        }
        expect(
            getCrdtDoc<{ tracks: { tracks: Array<{ id: string; inputMonitoring: string }> } }>(
                'root'
            )?.tracks.tracks.find((track) => track.id === 'a')?.inputMonitoring
        ).toBe('off');

        expect(await transaction.value).toBe(true);
        expect(source.disconnect).not.toHaveBeenCalled();
        expect(inputTrack.stop).not.toHaveBeenCalled();
        transaction.commit();

        expect(monitorOwners()).toEqual(['a']);
        expect(source.disconnect).not.toHaveBeenCalled();
        expect(inputTrack.stop).not.toHaveBeenCalled();
        expect(getUserMedia).toHaveBeenCalledTimes(1);
    });

    it.each([false, true])(
        'settles committed absence independently of projection notification, disposed=%s',
        async (disposed) => {
            await startInputMonitoring('a', null);
            await startInputMonitoring('b', null);
            const state = trackStore.value;
            if (!state) {
                throw new Error('Expected track state');
            }
            // The visible removal arrives first; its committed owner still vetoes teardown.
            trackStore.set({ ...state, tracks: state.tracks.filter((track) => track.id !== 'a') });
            expect(source.disconnect).not.toHaveBeenCalled();
            expect(docTrackIds()).toEqual(['a', 'b']);
            if (disposed) {
                unsubscribe?.();
                unsubscribe = undefined;
            }
            // No store hydration or notification accompanies this actual committed-root event.
            mutateCrdtDoc<{ tracks: { tracks: Array<{ id: string }> } }>({
                id: 'root',
                changeFn: (document) => {
                    const index = document.tracks.tracks.findIndex((track) => track.id === 'a');
                    if (index < 0) {
                        throw new Error('Expected committed owner A before removal');
                    }
                    document.tracks.tracks.splice(index, 1);
                },
            });

            expect(docTrackIds()).toEqual(['b']);
            if (disposed) {
                expect(source.disconnect).not.toHaveBeenCalled();
                expect(monitorOwners()).toEqual(['a', 'b']);
            } else {
                expect(source.disconnect).toHaveBeenCalledExactlyOnceWith(gains.get('a'));
                expect(docTrackIdsAtDisconnect).toEqual([['b']]);
                expect(monitorOwners()).toEqual(['b']);
            }
            expect(inputTrack.stop).not.toHaveBeenCalled();
            expect(getUserMedia).toHaveBeenCalledTimes(1);
        }
    );
});
