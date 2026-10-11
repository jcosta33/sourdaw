import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initInputMonitoringProjectAccess } from '#/app/initInputMonitoringProjectAccess';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';
import { createTrack, getArrangementHandlers, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import {
    audioEngine,
    configureInputMonitoringProjectAccess,
    startInputMonitoring,
    stopInputMonitoring,
    syncAutoInputMonitoring,
} from '#/modules/AudioEngine/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import { clearUndoHistory, undo } from '#/modules/Command/useCases';
import { createCrdtDoc, getCrdtDoc, mutateCrdtDoc, removeCrdtDoc } from '#/modules/CrdtDocument/useCases';

import { trackCommands } from '../TrackCommands';

const actionHarness = vi.hoisted(() => {
    const opens: Promise<void>[] = [];
    return { opens };
});

// Observe settlement without replacing the real public Command dispatcher.
vi.mock('#/modules/Command/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Command/useCases')>();
    return {
        ...actual,
        executeUserAppAction: (...args: Parameters<typeof actual.executeUserAppAction>) => {
            const opening = actual.executeUserAppAction(...args);
            actionHarness.opens.push(opening);
            return opening;
        },
    };
});

describe('palette Delete Track commits capture ownership through the registered action', () => {
    const originalMediaDevices = navigator.mediaDevices;
    const refusal = new Error('Palette track commit refused');
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] };
    let refuseCommit = false;
    let unsubscribe: () => void = () => undefined;
    const mediaSourceDescriptor = Object.getOwnPropertyDescriptor(audioEngine.context, 'createMediaStreamSource');
    let source: GainNode;
    let gainA: GainNode;
    let gainB: GainNode;

    function committedIds(): string[] {
        return (
            getCrdtDoc<{ tracks: { tracks: Array<{ id: string }> } }>('root')?.tracks.tracks.map((track) => track.id) ??
            []
        );
    }

    function deleteSelectedTrack(): Promise<void> {
        const command = trackCommands.find((entry) => entry.id === 'delete-track');
        if (!command || typeof command.action !== 'function') {
            throw new Error('Expected the real palette Delete Track entry');
        }
        const index = actionHarness.opens.length;
        command.action();
        const opening = actionHarness.opens[index];
        if (!opening) {
            throw new Error('The palette did not dispatch the registered action');
        }
        return opening;
    }

    function strip(trackId: string): ReturnType<typeof audioEngine.ensureTrackStrip> {
        const gain = audioEngine.context.createGain();
        return {
            trackId,
            gainNode: gain,
            preFaderTap: gain,
            faderNode: gain,
            postFaderGain: gain,
            panNode: Object.assign(audioEngine.context.createGain(), { pan: gain.gain }),
            meterNode: null,
            analyserNode: audioEngine.context.createAnalyser(),
            carrierGate: gain,
            preFaderSendGate: gain,
            muted: false,
            nativeCarried: false,
            soloGated: false,
            soloed: false,
            deviceNodes: [],
            midiFxNodes: [],
            meterBuffer: new Float32Array(128),
        };
    }

    beforeEach(() => {
        actionHarness.opens.length = 0;
        configureAutomergeStoragePort(null);
        stopInputMonitoring();
        createCrdtDoc('root');
        clearHandlerRegistry();
        const handlers = getArrangementHandlers();
        registerHandlerMap({ removeTrack: handlers.removeTrack, restoreTrack: handlers.restoreTrack });
        clearUndoHistory();
        setArrangementEventBus({ emit: async () => undefined });
        configureAutomergeStoragePort({
            getDoc: (id) => getCrdtDoc(id),
            getSemanticMessage: () => undefined,
            hasDoc: (id) => getCrdtDoc(id) !== undefined,
            mutateDoc: ({ docId, changeFn, message, snapshotTransaction, changedKeys }) => {
                if (refuseCommit) {
                    throw refusal;
                }
                mutateCrdtDoc({ id: docId, changeFn, message, snapshotTransaction, localSlots: changedKeys });
            },
        });
        trackStore.set({
            tracks: ['a', 'b'].map((id) => ({
                ...createTrack({ id, name: id, kind: 'audio', withoutDefaultDevice: true }),
                inputMonitoring: 'on',
            })),
            selectedTrackId: 'a',
        });
        flushAutomergeStorageWrites();
        source = audioEngine.context.createGain();
        vi.spyOn(source, 'connect');
        vi.spyOn(source, 'disconnect').mockImplementation(() => undefined);
        Object.defineProperty(audioEngine.context, 'createMediaStreamSource', {
            value: vi.fn((mediaStream: MediaStream) => Object.assign(source, { mediaStream })),
            configurable: true,
        });
        const strips = new Map([
            ['a', strip('a')],
            ['b', strip('b')],
        ]);
        vi.spyOn(audioEngine, 'ensureTrackStrip').mockImplementation((trackId) => {
            const current = strips.get(trackId);
            if (!current) {
                throw new Error(`Unexpected strip ${trackId}`);
            }
            return current;
        });
        vi.spyOn(audioEngine, 'removeTrackStrip').mockImplementation(() => undefined);
        vi.spyOn(audioEngine, 'initializeTrackStripFromSnapshot').mockReturnValue({
            acceptance: 'accepted',
            application: 'applied',
            correlation: { appRevision: 0, projectRevision: 'palette' },
            runtimeRevision: 0,
        });
        gainA = audioEngine.ensureTrackStrip('a').gainNode;
        gainB = audioEngine.ensureTrackStrip('b').gainNode;
        stop.mockClear();
        Object.defineProperty(navigator, 'mediaDevices', {
            value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
            configurable: true,
        });
        initInputMonitoringProjectAccess();
        unsubscribe = syncAutoInputMonitoring();
    });

    afterEach(() => {
        refuseCommit = false;
        unsubscribe();
        configureInputMonitoringProjectAccess(null);
        stopInputMonitoring();
        audioEngine.removeTrackStrip('a');
        audioEngine.removeTrackStrip('b');
        vi.restoreAllMocks();
        if (mediaSourceDescriptor) {
            Object.defineProperty(audioEngine.context, 'createMediaStreamSource', mediaSourceDescriptor);
        } else {
            Reflect.deleteProperty(audioEngine.context, 'createMediaStreamSource');
        }
        clearUndoHistory();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null });
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        Object.defineProperty(navigator, 'mediaDevices', { value: originalMediaDevices, configurable: true });
    });

    it('preserves both committed and live owners on refusal and closes only the selected owner on commit', async () => {
        await startInputMonitoring('a', null);
        await startInputMonitoring('b', null);
        expect(source.connect).toHaveBeenCalledWith(gainA);
        expect(source.connect).toHaveBeenCalledWith(gainB);
        refuseCommit = true;
        await expect(deleteSelectedTrack()).rejects.toBe(refusal);
        refuseCommit = false;
        expect(committedIds()).toEqual(['a', 'b']);
        expect(trackStore.value?.tracks.map((track) => track.id)).toEqual(['a', 'b']);
        expect(trackStore.value?.selectedTrackId).toBe('a');
        expect(undoHistoryStore.value?.past).toEqual([]);
        expect(source.disconnect).not.toHaveBeenCalled();
        expect(audioEngine.removeTrackStrip).not.toHaveBeenCalled();
        expect(stop).not.toHaveBeenCalled();
        await deleteSelectedTrack();
        expect(committedIds()).toEqual(['b']);
        expect(trackStore.value?.tracks.map((track) => track.id)).toEqual(['b']);
        expect(source.disconnect).toHaveBeenCalledExactlyOnceWith(gainA);
        expect(source.disconnect).not.toHaveBeenCalledWith(gainB);
        expect(stop).not.toHaveBeenCalled();
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        await undo();
        await vi.waitFor(() => expect(source.connect).toHaveBeenCalledTimes(3));
        expect(committedIds()).toEqual(['a', 'b']);
        expect(trackStore.value?.tracks.map((track) => track.id)).toEqual(['a', 'b']);
        expect(stop).not.toHaveBeenCalled();
    });
});
