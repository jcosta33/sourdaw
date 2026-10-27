import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import {
    audioEngine,
    configureRuntimeGraphProjectRevisionValidator,
    configureRuntimeGraphTopologyValidator,
} from '#/modules/AudioEngine/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction, redo, undo } from '#/modules/Command/useCases';
import {
    captureProjectRevision,
    createCrdtDoc,
    projectCrdtToStores,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    setupProjectionBridge,
} from '#/modules/CrdtDocument/useCases';
import { defaultTransportState, timeSignatureMapStore, transportStore } from '#/modules/Transport/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { trackStore } from '../../../stores/trackStore';
import { getArrangementHandlers } from '../../getArrangementHandlers';
import { importMidiFile } from '../../importMidiFile';
import { runtimeGraphTopology } from '../../runtimeGraphTopology';

// Physical Web Audio nodes are doubled; the engine, graph validation, import,
// Command transaction, CRDT projection, and history are production implementations.
vi.mock('#/modules/AudioEngine/repositories/createWebAudioEngine', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/AudioEngine/repositories/createWebAudioEngine')>();
    const { createMockAudioContext } = await import('#/helpers/__tests__/audioContext.mock');
    return { ...actual, audioEngine: actual.createAudioEngine(createMockAudioContext() as unknown as AudioContext) };
});
vi.mock('#/modules/MIDI/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/useCases')>()),
    readMidiFile: vi.fn(async () => ({
        declaredTrackCount: 1,
        tracks: [
            {
                name: 'Imported',
                notes: [{ id: 'imported-note', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }],
                ccs: [],
                endTick: 480,
            },
        ],
        truncated: false,
        timing: { format: 0, ticksPerBeat: 480, events: [], complete: true },
    })),
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

class MeterWorklet {
    port = { postMessage: vi.fn(), close: vi.fn() };
    connect = vi.fn();
    disconnect = vi.fn();
}

let stopProjection: (() => void) | undefined;

function importedTrack() {
    const track = trackStore.value?.tracks.find((track) => track.name === 'Imported');
    if (!track) throw new Error('Expected completed imported track');
    return track;
}

beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubGlobal('AudioWorkletNode', MeterWorklet);
    configureAutomergeStoragePort(null);
    resetCrdtProjectAuthority('cold imported device edit');
    removeCrdtDoc('root');
    createCrdtDoc('root');
    registerCrdtStorageRuntime();
    stopProjection = setupProjectionBridge();
    projectCrdtToStores();
    transportStore.set(defaultTransportState);
    timeSignatureMapStore.set({ changes: [] });
    trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    flushAutomergeStorageWrites();
    clearHandlerRegistry();
    registerHandlerMap(getArrangementHandlers());
    clearUndoHistory();
    audioEngine.resetGraph();
    configureRuntimeGraphProjectRevisionValidator((revision) => revision === captureProjectRevision());
    configureRuntimeGraphTopologyValidator(runtimeGraphTopology.matchesCurrentProject);
    await audioEngine.initialize();
    expect(trackStore.value?.tracks).toEqual([]);
});

afterEach(() => {
    audioEngine.resetGraph();
    configureRuntimeGraphProjectRevisionValidator(null);
    configureRuntimeGraphTopologyValidator(null);
    clearUndoHistory();
    clearHandlerRegistry();
    stopProjection?.();
    stopProjection = undefined;
    configureAutomergeStoragePort(null);
    removeCrdtDoc('root');
    vi.unstubAllGlobals();
});

describe('device edits on an imported track before first Play', () => {
    it('removes the default Synth cleanly and preserves its identity through undo and redo', async () => {
        await expect(importMidiFile(new File([], 'small.mid'), { shouldContinue: () => true })).resolves.toBe(
            'completed'
        );
        const track = importedTrack();
        const synth = structuredClone(track.devices[0]);
        expect(synth?.type).toBe('builtin-synth');
        expect(track.clips).toHaveLength(1);
        expect(audioEngine.getTrackStrip(track.id)).toBeUndefined();
        clearUndoHistory();

        await expect(
            executeAppAction({ type: 'removeDevice', payload: { deviceId: synth!.id } })
        ).resolves.toBeUndefined();
        expect(importedTrack().devices).toEqual([]);
        expect(audioEngine.getTrackStrip(track.id)?.deviceNodes).toEqual([]);
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        expect(notifyUser).not.toHaveBeenCalled();

        await undo();
        expect(importedTrack().devices).toEqual([synth]);
        expect(audioEngine.getTrackStrip(track.id)?.deviceNodes.map((device) => device.deviceId)).toEqual([synth!.id]);
        await redo();
        expect(importedTrack().devices).toEqual([]);
        expect(audioEngine.getTrackStrip(track.id)?.deviceNodes).toEqual([]);
        expect(notifyUser).not.toHaveBeenCalled();
    });
});
