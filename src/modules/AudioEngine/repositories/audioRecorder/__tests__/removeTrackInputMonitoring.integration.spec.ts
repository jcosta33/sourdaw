import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initInputMonitoringProjectAccess } from '#/app/initInputMonitoringProjectAccess';
import {
    configureAutomergeStoragePort,
    createAutomergeStoragePreview,
    flushAutomergeStorageWrites,
    runWithAutomergeStorageTransaction,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';
import {
    createTrack,
    getArrangementHandlers,
    removeTrack,
    setArrangementEventBus,
} from '#/modules/Arrangement/useCases';
import {
    configureInputMonitoringProjectAccess,
    startInputMonitoring,
    stopInputMonitoring,
    syncAutoInputMonitoring,
} from '#/modules/AudioEngine/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction, redo, undo } from '#/modules/Command/useCases';
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
    const connectedGains = new Set<unknown>();
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

    function watchRuntimeRemovalUnsubscribe() {
        const subscribe = trackStore.subscribe.bind(trackStore);
        const stopped = vi.fn();
        const spy = vi.spyOn(trackStore, 'subscribe').mockImplementation((listener) => {
            const unsubscribe = subscribe(listener);
            return () => {
                stopped();
                unsubscribe();
            };
        });
        return { stopped, restore: () => spy.mockRestore() };
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
        connectedGains.clear();
        clearHandlerRegistry();
        const handlers = getArrangementHandlers();
        registerHandlerMap({
            removeTrack: handlers.removeTrack,
            removeAllTracks: handlers.removeAllTracks,
            restoreTrack: handlers.restoreTrack,
            restoreTracks: handlers.restoreTracks,
            setTrackInput: handlers.setTrackInput,
            restoreTrackInput: handlers.restoreTrackInput,
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
        source.connect.mockImplementation((destination: unknown) => {
            connectedGains.add(destination);
            docTrackIdsAtConnect.push(docTrackIds());
        });
        source.disconnect.mockImplementation((destination?: unknown) => {
            if (destination === undefined) {
                connectedGains.clear();
            } else {
                connectedGains.delete(destination);
            }
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

    it.each(['abort', 'commit'] as const)(
        'settles direct removal runtime only after committed absence, terminal=%s',
        async (terminal) => {
            await startInputMonitoring('a', null);
            await startInputMonitoring('b', null);
            source.disconnect.mockClear();
            const subscription = watchRuntimeRemovalUnsubscribe();
            const transaction = runWithAutomergeStorageTransaction(undefined, () => removeTrack('a'));
            if (transaction.status === 'threw') {
                throw transaction.error;
            }
            try {
                expect(docTrackIds()).toEqual(['a', 'b']);
                expect(liveTrackIds()).toEqual(['b']);
                expect(monitorOwners()).toEqual(['a', 'b']);
                expect(source.disconnect).not.toHaveBeenCalled();
                expect(engine.removeTrackStrip).not.toHaveBeenCalled();
                if (terminal === 'commit') {
                    transaction.commit();
                }
            } finally {
                transaction.abort();
                subscription.restore();
            }
            expect(subscription.stopped).toHaveBeenCalledOnce();
            expect(docTrackIds()).toEqual(terminal === 'commit' ? ['b'] : ['a', 'b']);
            expect(liveTrackIds()).toEqual(terminal === 'commit' ? ['b'] : ['a', 'b']);
            expect(monitorOwners()).toEqual(terminal === 'commit' ? ['b'] : ['a', 'b']);
            expect(engine.removeTrackStrip).toHaveBeenCalledTimes(terminal === 'commit' ? 1 : 0);
            expect(inputTrack.stop).not.toHaveBeenCalled();
            if (terminal === 'abort') {
                // An aborted finalizer must not fire on a later removal's publication.
                await executeAppAction({ type: 'removeTrack', payload: { trackId: 'a' } });
                expect(engine.removeTrackStrip).toHaveBeenCalledExactlyOnceWith('a');
                expect(source.disconnect).toHaveBeenCalledExactlyOnceWith(gains.get('a'));
            }
        }
    );

    it('preserves committed runtime while a refused direct write remains pending', async () => {
        await startInputMonitoring('a', null);
        await startInputMonitoring('b', null);
        removeTrack('a');
        refuseCommit = true;
        expect(() => flushAutomergeStorageWrites()).toThrow();
        refuseCommit = false;
        expect(docTrackIds()).toEqual(['a', 'b']);
        expect(liveTrackIds()).toEqual(['b']);
        expect(monitorOwners()).toEqual(['a', 'b']);
        expect(source.disconnect).not.toHaveBeenCalled();
        expect(engine.removeTrackStrip).not.toHaveBeenCalled();
        // Unscoped storage retains a refused write for retry; it has no Command abort.
        flushAutomergeStorageWrites();
        expect(docTrackIds()).toEqual(['b']);
        expect(engine.removeTrackStrip).toHaveBeenCalledExactlyOnceWith('a');
        expect(monitorOwners()).toEqual(['b']);
    });

    it('retires an outgoing direct runtime finalizer when a new root reuses the track identity', async () => {
        await startInputMonitoring('a', null);
        const subscription = watchRuntimeRemovalUnsubscribe();
        const transaction = runWithAutomergeStorageTransaction(undefined, () => removeTrack('a'));
        if (transaction.status === 'threw') {
            throw transaction.error;
        }
        try {
            const state = trackStore.value;
            if (!state) {
                throw new Error('Expected visible state before replacing the root');
            }
            stopInputMonitoring();
            removeCrdtDoc('root');
            createCrdtDoc('root');
            trackStore.set({
                ...state,
                tracks: [
                    {
                        ...createTrack({ id: 'a', name: 'New owner', kind: 'audio', withoutDefaultDevice: true }),
                        inputMonitoring: 'on',
                    },
                ],
            });
            flushAutomergeStorageWrites();
            expect(subscription.stopped).toHaveBeenCalledOnce();
            const incomingGain = { id: 'incoming-gain-a' };
            const incomingSource = { connect: vi.fn(), disconnect: vi.fn() };
            const incomingTrack = { stop: vi.fn() };
            getUserMedia.mockResolvedValueOnce({ getTracks: () => [incomingTrack] });
            engine.createMediaStreamSource.mockReturnValueOnce(incomingSource);
            engine.ensureTrackStrip.mockReturnValueOnce({ gainNode: incomingGain });
            expect(await startInputMonitoring('a', null)).toBe(true);
            expect(monitorOwners()).toEqual(['a']);
            expect(incomingSource.connect).toHaveBeenCalledExactlyOnceWith(incomingGain);
            expect(inputMonitoringSession.captures.get(null)?.monitorEdges.get('a')).toBe(incomingGain);
            mutateCrdtDoc<{ tracks: { tracks: Array<{ id: string; name: string }> } }>({
                id: 'root',
                changeFn: (document) => {
                    document.tracks.tracks[0].name = 'Incoming owner after publication';
                },
            });
            expect(engine.removeTrackStrip).not.toHaveBeenCalled();
            expect(incomingSource.disconnect).not.toHaveBeenCalled();
            expect(incomingTrack.stop).not.toHaveBeenCalled();
            mutateCrdtDoc<{ tracks: { tracks: Array<{ id: string }> } }>({
                id: 'root',
                changeFn: (document) => {
                    document.tracks.tracks.splice(0, 1);
                },
            });
            expect(engine.removeTrackStrip).not.toHaveBeenCalled();
            const incomingState = trackStore.value;
            if (!incomingState) {
                throw new Error('Expected incoming projection before publishing its removal');
            }
            // The controlled storage port does not project arbitrary raw mutations.
            trackStore.set({ ...incomingState, tracks: [] });
            expect(engine.removeTrackStrip).not.toHaveBeenCalled();
            expect(incomingTrack.stop).toHaveBeenCalledOnce();
        } finally {
            transaction.abort();
            subscription.restore();
        }
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

    it.each(['edge', 'source', 'both'] as const)(
        'stops the last committed owner even when %s disconnect fails',
        async (fault) => {
            await startInputMonitoring('a', null);
            const retainedCapture = inputMonitoringSession.captures.get(null);
            source.disconnect.mockImplementation((destination?: unknown) => {
                if (
                    (destination !== undefined && fault !== 'source') ||
                    (destination === undefined && fault !== 'edge')
                ) {
                    throw new Error('Monitor disconnect refused');
                }
                connectedGains.clear();
            });
            try {
                await executeAppAction({ type: 'removeTrack', payload: { trackId: 'a' } });
                expect(docTrackIds()).toEqual(['b']);
                expect(liveTrackIds()).toEqual(['b']);
                expect(monitorOwners()).toEqual([]);
                expect(retainedCapture?.monitorEdges.size).toBe(0);
                expect(inputMonitoringSession.captures.size).toBe(0);
                expect(inputTrack.stop).toHaveBeenCalledOnce();
                expect(engine.removeTrackStrip).toHaveBeenCalledWith('a');
                expect(source.disconnect).toHaveBeenCalledWith();
                expect(connectedGains.size).toBe(fault === 'both' ? 1 : 0);
            } finally {
                source.disconnect.mockImplementation(() => connectedGains.clear());
            }
        }
    );

    it('preserves the shared survivor when the removed owner edge disconnect fails', async () => {
        await startInputMonitoring('a', null);
        await startInputMonitoring('b', null);
        const retainedCapture = inputMonitoringSession.captures.get(null);
        if (!retainedCapture) {
            throw new Error('Expected shared capture before removal');
        }
        source.disconnect.mockImplementation((destination?: unknown) => {
            if (destination === gains.get('a')) {
                throw new Error('Removed monitor edge disconnect refused');
            }
            if (destination === undefined) {
                connectedGains.clear();
            } else {
                connectedGains.delete(destination);
            }
        });
        try {
            await executeAppAction({ type: 'removeTrack', payload: { trackId: 'a' } });
            expect(monitorOwners()).toEqual(['b']);
            expect([...retainedCapture.monitorEdges.keys()]).toEqual(['b']);
            expect(connectedGains.has(gains.get('b'))).toBe(true);
            expect(inputMonitoringSession.captures.get(null)).toBe(retainedCapture);
            expect(inputTrack.stop).not.toHaveBeenCalled();
            expect(engine.removeTrackStrip).toHaveBeenCalledWith('a');
            await executeAppAction({ type: 'removeTrack', payload: { trackId: 'b' } });
            expect(inputMonitoringSession.captures.size).toBe(0);
            expect(connectedGains.size).toBe(0);
            expect(inputTrack.stop).toHaveBeenCalledOnce();
        } finally {
            source.disconnect.mockImplementation(() => connectedGains.clear());
        }
    });

    it('moves a pending direct On survivor to the committed selected input before the old grant', async () => {
        const old = deferredGrant();
        const selected = deferredGrant();
        const selectedStop = vi.fn();
        const selectedStream = { getTracks: () => [{ stop: selectedStop }] };
        const selectedSource = { connect: vi.fn(), disconnect: vi.fn() };
        getUserMedia.mockReturnValueOnce(old.request).mockReturnValueOnce(selected.request);
        engine.createMediaStreamSource.mockImplementation((captured) =>
            captured === selectedStream ? selectedSource : source
        );
        const first = startInputMonitoring('a', null);
        const survivor = startInputMonitoring('b', null);
        await executeAppAction({ type: 'removeTrack', payload: { trackId: 'a' } });
        await executeAppAction({ type: 'setTrackInput', payload: { trackId: 'b', inputId: 'new-input' } });
        expect(
            getCrdtDoc<{ tracks: { tracks: Array<{ id: string; inputId: string | null }> } }>('root')?.tracks.tracks
        ).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'b', inputId: 'new-input' })]));
        old.grant(stream);
        try {
            await first;
            await survivor;
            expect(source.connect).not.toHaveBeenCalled();
            expect(inputTrack.stop).toHaveBeenCalledOnce();
            expect(inputMonitoringSession.trackKeys.get('b')).toBe('new-input');
            expect(inputMonitoringSession.captures.has(null)).toBe(false);
            expect(getUserMedia).toHaveBeenCalledTimes(2);
        } finally {
            selected.grant(selectedStream);
        }
        await vi.waitFor(() => expect(selectedSource.connect).toHaveBeenCalledWith(gains.get('b')));
        expect(selectedStop).not.toHaveBeenCalled();
        expect(monitorOwners()).toEqual(['b']);
        const selectedCapture = inputMonitoringSession.captures.get('new-input');
        if (!selectedCapture) {
            throw new Error('Expected the selected input capture');
        }
        expect([...selectedCapture.monitorEdges.keys()]).toEqual(['b']);
        expect(selectedCapture.monitorStream).toBe(selectedStream);
    });

    it('completes bulk Undo and later editing while both independent input grants remain pending', async () => {
        const state = trackStore.value;
        if (!state) {
            throw new Error('Expected tracks before selecting independent inputs');
        }
        trackStore.set({
            ...state,
            tracks: state.tracks.map((track) => ({ ...track, inputId: `mic-${track.id}` })),
        });
        flushAutomergeStorageWrites();
        await executeAppAction({ type: 'removeAllTracks', payload: undefined });
        const first = deferredGrant();
        const second = deferredGrant();
        const secondStop = vi.fn();
        const secondStream = { getTracks: () => [{ stop: secondStop }] };
        const secondSource = { connect: vi.fn(), disconnect: vi.fn() };
        getUserMedia.mockReturnValueOnce(first.request).mockReturnValueOnce(second.request);
        engine.createMediaStreamSource.mockImplementation((captured) =>
            captured === secondStream ? secondSource : source
        );
        let completed = false;
        const restoring = undo().then((result) => {
            completed = true;
            return result;
        });
        try {
            await vi.waitFor(() => {
                expect(getUserMedia).toHaveBeenCalledTimes(2);
                expect(completed).toBe(true);
            });
            expect(getUserMedia).toHaveBeenNthCalledWith(1, {
                audio: expect.objectContaining({ deviceId: { exact: 'mic-a' } }),
            });
            expect(getUserMedia).toHaveBeenNthCalledWith(2, {
                audio: expect.objectContaining({ deviceId: { exact: 'mic-b' } }),
            });
            expect(inputMonitoringSession.captures.size).toBe(0);
            expect(inputMonitoringSession.pendingRequests.size).toBe(2);
            expect(source.connect).not.toHaveBeenCalled();
            expect(secondSource.connect).not.toHaveBeenCalled();
            expect(await restoring).toEqual({ headConsumed: true });
            expect(docTrackIds()).toEqual(['a', 'b']);
            expect(liveTrackIds()).toEqual(['a', 'b']);
            expect(undoHistoryStore.value?.past).toEqual([]);
            const editing = executeAppAction({ type: 'removeTrack', payload: { trackId: 'a' } });
            await vi.waitFor(() => expect(docTrackIds()).toEqual(['b']));
            await editing;
            let laterHistoryCompleted = false;
            const laterUndo = undo().then((result) => {
                laterHistoryCompleted = true;
                return result;
            });
            await vi.waitFor(() => expect(laterHistoryCompleted).toBe(true));
            expect(await laterUndo).toEqual({ headConsumed: true });
            expect(docTrackIds()).toEqual(['a', 'b']);
            await redo();
            expect(docTrackIds()).toEqual(['b']);
            expect(monitorOwners()).toEqual(['b']);
        } finally {
            first.grant(stream);
            second.grant(secondStream);
            await restoring;
        }
        await vi.waitFor(() => expect(secondSource.connect).toHaveBeenCalledWith(gains.get('b')));
        expect(source.connect).not.toHaveBeenCalled();
        expect(inputTrack.stop).toHaveBeenCalledOnce();
        expect(secondStop).not.toHaveBeenCalled();
        expect([...inputMonitoringSession.captures.keys()]).toEqual(['mic-b']);
        const survivingCapture = inputMonitoringSession.captures.get('mic-b');
        if (!survivingCapture) {
            throw new Error('Expected the surviving independent input capture');
        }
        expect([...survivingCapture.monitorEdges.keys()]).toEqual(['b']);
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

    it.each([false, true])(
        'keeps restored truth and history completion when permission is denied, ambiguous=%s',
        async (ambiguous) => {
            await startInputMonitoring('a', null);
            await startInputMonitoring('b', null);
            await executeAppAction({ type: 'removeAllTracks', payload: undefined });
            getUserMedia.mockRejectedValue(new Error('Microphone denied'));

            failAfterPublication = ambiguous;
            if (ambiguous) {
                await expect(undo()).rejects.toThrow();
            } else {
                await expect(undo()).resolves.toEqual({ headConsumed: true });
            }
            failAfterPublication = false;
            await vi.waitFor(() => expect(monitorOwners()).toEqual([]));

            expect(docTrackIds()).toEqual(['a', 'b']);
            expect(liveTrackIds()).toEqual(['a', 'b']);
            expect(trackStore.value?.tracks.map((track) => track.inputMonitoring)).toEqual(['on', 'on']);
            expect(monitorOwners()).toEqual([]);
            expect(undoHistoryStore.value?.past).toEqual([]);
        }
    );

    it.each([false, true])(
        'does not admit optimistic On while restoring saved Off, ambiguous=%s',
        async (ambiguous) => {
            const state = trackStore.value;
            if (!state) {
                throw new Error('Expected track state');
            }
            trackStore.set({
                ...state,
                tracks: state.tracks.map((track) => ({ ...track, inputMonitoring: 'off' })),
            });
            flushAutomergeStorageWrites();
            await executeAppAction({ type: 'removeTrack', payload: { trackId: 'a' } });
            expect(getUserMedia).not.toHaveBeenCalled();

            let abortOptimistic: (() => void) | undefined;
            engine.initializeTrackStripFromSnapshot.mockImplementationOnce(() => {
                const transaction = runWithAutomergeStorageTransaction(undefined, () => {
                    const live = trackStore.value;
                    if (!live) {
                        throw new Error('Expected restored track state');
                    }
                    trackStore.set({
                        ...live,
                        tracks: live.tracks.map((track) =>
                            track.id === 'a' ? { ...track, inputMonitoring: 'on' } : track
                        ),
                    });
                });
                if (transaction.status === 'threw') {
                    throw transaction.error;
                }
                abortOptimistic = transaction.abort;
                expect(getUserMedia).not.toHaveBeenCalled();
                return { acceptance: 'accepted', application: 'applied' };
            });

            let observedRequests = -1;
            let observedOwners: string[] = [];
            let observedConnections = -1;
            try {
                if (ambiguous) {
                    const entry = undoHistoryStore.value?.past.at(-1);
                    if (!entry || entry.kind !== 'action' || entry.inverseAction?.type !== 'restoreTrack') {
                        throw new Error('Expected the real track deletion inverse');
                    }
                    failAfterPublication = true;
                    await expect(executeAppAction(entry.inverseAction)).rejects.toThrow();
                    failAfterPublication = false;
                } else {
                    await undo();
                }
                observedRequests = getUserMedia.mock.calls.length;
                observedOwners = monitorOwners();
                observedConnections = source.connect.mock.calls.length;
            } finally {
                abortOptimistic?.();
            }

            const committedModes = getCrdtDoc<{ tracks: { tracks: Array<{ id: string; inputMonitoring: string }> } }>(
                'root'
            )?.tracks.tracks;
            expect(committedModes?.find((track) => track.id === 'a')?.inputMonitoring).toBe('off');
            expect(observedConnections).toBe(0);
            expect(observedOwners).toEqual([]);
            expect(observedRequests).toBe(0);
        }
    );

    it('reads the current committed input after restored strip effects', async () => {
        await executeAppAction({ type: 'removeAllTracks', payload: undefined });
        engine.initializeTrackStripFromSnapshot.mockImplementationOnce(() => {
            mutateCrdtDoc({
                id: 'root',
                changeFn: (document) => {
                    const slot = document.tracks;
                    if (!slot || typeof slot !== 'object' || !('tracks' in slot) || !Array.isArray(slot.tracks)) {
                        throw new Error('Expected restored tracks');
                    }
                    const track = slot.tracks.find((candidate: { id: string }) => candidate.id === 'a');
                    if (!track) {
                        throw new Error('Expected restored owner A');
                    }
                    track.inputId = 'committed-input';
                },
            });
            return { acceptance: 'accepted', application: 'applied' };
        });

        await undo();

        expect(getUserMedia).toHaveBeenCalledWith({
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                deviceId: { exact: 'committed-input' },
            },
        });
        expect(inputMonitoringSession.trackKeys.get('a')).toBe('committed-input');
        expect(source.connect).toHaveBeenCalledWith(gains.get('a'));
        expect(docTrackIds()).toEqual(['a', 'b']);
    });

    it.each([
        ['off', false],
        ['input', false],
        ['delete', false],
        ['off', true],
        ['input', true],
        ['delete', true],
    ] as const)(
        'fences a pending restored grant after committed %s changes, ambiguous=%s',
        async (change, ambiguous) => {
            const state = trackStore.value;
            if (!state) {
                throw new Error('Expected tracks before restoring pending owner');
            }
            trackStore.set({
                ...state,
                tracks: state.tracks.map((track) => (track.id === 'b' ? { ...track, inputMonitoring: 'off' } : track)),
            });
            flushAutomergeStorageWrites();
            await executeAppAction({ type: 'removeTrack', payload: { trackId: 'a' } });
            const pending = deferredGrant();
            const successor = deferredGrant();
            const selectedStop = vi.fn();
            const selectedStream = { getTracks: () => [{ stop: selectedStop }] };
            const selectedSource = { connect: vi.fn(), disconnect: vi.fn() };
            engine.createMediaStreamSource.mockImplementation((captured) =>
                captured === selectedStream ? selectedSource : source
            );
            let requested: (() => void) | undefined;
            const requestStarted = new Promise<void>((resolve) => {
                requested = resolve;
            });
            getUserMedia
                .mockImplementationOnce(() => {
                    requested?.();
                    return pending.request;
                })
                .mockReturnValue(successor.request);
            failAfterPublication = ambiguous;
            const restore = undo();
            let completion: Promise<unknown>;
            if (ambiguous) {
                completion = expect(restore).rejects.toThrow();
            } else {
                completion = expect(restore).resolves.toEqual({ headConsumed: true });
            }
            await requestStarted;
            await completion;
            failAfterPublication = false;
            expect(monitorOwners()).toEqual(['a']);
            mutateCrdtDoc({
                id: 'root',
                changeFn: (document) => {
                    const slot = document.tracks;
                    if (!slot || typeof slot !== 'object' || !('tracks' in slot) || !Array.isArray(slot.tracks)) {
                        throw new Error('Expected restored tracks');
                    }
                    if (change === 'delete') {
                        const index = slot.tracks.findIndex((track: { id: string }) => track.id === 'a');
                        if (index !== -1) {
                            slot.tracks.splice(index, 1);
                        }
                        return;
                    }
                    for (const track of slot.tracks) {
                        if (change === 'off') {
                            track.inputMonitoring = 'off';
                        } else {
                            track.inputId = 'new-input';
                        }
                    }
                },
            });
            pending.grant(stream);
            await vi.waitFor(() => expect(inputTrack.stop).toHaveBeenCalledOnce());
            expect(monitorOwners()).toEqual(change === 'input' ? ['a'] : []);
            expect(source.connect).not.toHaveBeenCalledWith(gains.get('a'));
            expect(docTrackIds()).toEqual(change === 'delete' ? ['b'] : ['a', 'b']);
            expect(engine.createMediaStreamSource).not.toHaveBeenCalled();
            expect(inputTrack.stop).toHaveBeenCalledOnce();
            if (change === 'input') {
                expect(inputMonitoringSession.trackKeys.get('a')).toBe('new-input');
                expect(getUserMedia).toHaveBeenCalledTimes(2);
                successor.grant(selectedStream);
                await vi.waitFor(() => expect(selectedSource.connect).toHaveBeenCalledWith(gains.get('a')));
                expect(selectedStop).not.toHaveBeenCalled();
            }
        }
    );

    it.each([false, true])(
        'fences the old restored grant and preserves the selected input while sharing capture, deleteSurvivor=%s',
        async (deleteSurvivor) => {
            await executeAppAction({ type: 'removeTrack', payload: { trackId: 'a' } });
            const pending = deferredGrant();
            const successor = deferredGrant();
            const selectedStop = vi.fn();
            const selectedStream = { getTracks: () => [{ stop: selectedStop }] };
            const selectedSource = { connect: vi.fn(), disconnect: vi.fn() };
            engine.createMediaStreamSource.mockImplementation((captured) =>
                captured === selectedStream ? selectedSource : source
            );
            getUserMedia.mockReturnValueOnce(pending.request).mockReturnValue(successor.request);
            const survivorStart = startInputMonitoring('b', null);
            const restore = undo();
            await vi.waitFor(() => expect(monitorOwners()).toEqual(['a', 'b']));
            expect(getUserMedia).toHaveBeenCalledOnce();
            mutateCrdtDoc({
                id: 'root',
                changeFn: (document) => {
                    const slot = document.tracks;
                    if (!slot || typeof slot !== 'object' || !('tracks' in slot) || !Array.isArray(slot.tracks)) {
                        throw new Error('Expected restored tracks');
                    }
                    const track = slot.tracks.find((candidate: { id: string }) => candidate.id === 'a');
                    if (!track) {
                        throw new Error('Expected restored owner A');
                    }
                    track.inputId = 'new-input';
                },
            });
            if (deleteSurvivor) {
                await executeAppAction({ type: 'removeTrack', payload: { trackId: 'b' } });
            }
            pending.grant(stream);
            await restore;
            expect(await survivorStart).toBe(!deleteSurvivor);
            expect(monitorOwners()).toEqual(deleteSurvivor ? ['a'] : ['a', 'b']);
            expect(inputMonitoringSession.trackKeys.get('a')).toBe('new-input');
            expect(getUserMedia).toHaveBeenCalledTimes(2);
            expect(source.connect).not.toHaveBeenCalledWith(gains.get('a'));
            expect(inputTrack.stop).toHaveBeenCalledTimes(deleteSurvivor ? 1 : 0);
            expect(docTrackIds()).toEqual(deleteSurvivor ? ['a'] : ['a', 'b']);
            if (deleteSurvivor) {
                expect(engine.createMediaStreamSource).not.toHaveBeenCalled();
            } else {
                expect(source.connect).toHaveBeenCalledExactlyOnceWith(gains.get('b'));
            }
            successor.grant(selectedStream);
            await vi.waitFor(() => expect(selectedSource.connect).toHaveBeenCalledWith(gains.get('a')));
            expect(selectedStop).not.toHaveBeenCalled();
        }
    );

    it.each(['direct', 'restored'] as const)(
        'retains a granted %s On owner through optimistic deletion and reconnects after abort',
        async (route) => {
            const pending = deferredGrant();
            getUserMedia.mockReturnValue(pending.request);
            let opening: Promise<boolean> | undefined;
            if (route === 'restored') {
                await executeAppAction({ type: 'removeTrack', payload: { trackId: 'a' } });
                await undo();
            } else {
                opening = startInputMonitoring('a', null);
            }
            expect(monitorOwners()).toEqual(['a']);
            const transaction = runWithAutomergeStorageTransaction(undefined, () =>
                getArrangementHandlers().removeTrack.execute({ type: 'removeTrack', payload: { trackId: 'a' } })
            );
            if (transaction.status === 'threw') {
                throw transaction.error;
            }
            try {
                expect(liveTrackIds()).toEqual(['b']);
                expect(docTrackIds()).toEqual(['a', 'b']);
                engine.ensureTrackStrip.mockClear();
                source.connect.mockClear();
                pending.grant(stream);
                await vi.waitFor(() => expect(inputMonitoringSession.pendingRequests.size).toBe(0));
                if (opening) {
                    expect(await opening).toBe(true);
                }
                expect(monitorOwners()).toEqual(['a']);
                expect(inputTrack.stop).not.toHaveBeenCalled();
                expect(source.connect).not.toHaveBeenCalled();
                expect(engine.ensureTrackStrip).not.toHaveBeenCalled();
            } finally {
                transaction.abort();
            }
            await vi.waitFor(() => expect(source.connect).toHaveBeenCalledWith(gains.get('a')));
            expect(docTrackIds()).toEqual(['a', 'b']);
            expect(liveTrackIds()).toEqual(['a', 'b']);
            expect(monitorOwners()).toEqual(['a']);
            expect(inputTrack.stop).not.toHaveBeenCalled();
            expect(getUserMedia).toHaveBeenCalledOnce();
        }
    );

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
