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
import { clearUndoHistory, executeAppAction, executeAppActionBatch, redo, undo } from '#/modules/Command/useCases';
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
import { compileTrackStripInitializationSnapshot } from '../../compileTrackStripInitializationSnapshot';

// Physical Web Audio nodes are doubled; the engine, graph validation, import,
// Command transaction, CRDT projection, and history are production implementations.
const { createMockAudioContext } = await vi.hoisted(async () => {
    const { createMockAudioContext } = await import('#/helpers/__tests__/audioContext.mock');
    // The production singleton constructs its context when its module loads.
    vi.stubGlobal('AudioContext', createMockAudioContext);
    return { createMockAudioContext };
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
    if (!track) {
        throw new Error('Expected completed imported track');
    }
    return track;
}

beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubGlobal('AudioContext', createMockAudioContext);
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
    vi.restoreAllMocks();
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
    it('removes and restores an EQ while retaining the imported per-note Synth', async () => {
        await importMidiFile(new File([], 'small.mid'), { shouldContinue: () => true });
        const track = importedTrack();
        const synth = structuredClone(track.devices[0]);
        expect(synth?.type).toBe('builtin-synth');
        expect(audioEngine.getTrackStrip(track.id)).toBeUndefined();
        const initialize = vi.spyOn(audioEngine, 'initializeTrackStripFromSnapshot');

        await executeAppAction({
            type: 'addDevice',
            payload: { trackId: track.id, deviceType: 'builtin-eq', deviceId: 'retained-synth-eq' },
        });
        expect(initialize).toHaveBeenCalledTimes(1);
        expect(initialize.mock.calls[0]?.[0]).toMatchObject({
            nodes: [
                expect.objectContaining({
                    devices: [
                        expect.objectContaining({ id: synth?.id, type: 'builtin-synth' }),
                        expect.objectContaining({ id: 'retained-synth-eq', type: 'builtin-eq' }),
                    ],
                }),
            ],
        });
        expect(audioEngine.getTrackStrip(track.id)?.deviceNodes.map((device) => device.deviceId)).toEqual([
            'retained-synth-eq',
        ]);
        await executeAppAction({
            type: 'setDeviceParameter',
            payload: { deviceId: 'retained-synth-eq', paramId: 'eq-mid-freq', value: 2400 },
        });
        await executeAppAction({
            type: 'bypassDevice',
            payload: { deviceId: 'retained-synth-eq', bypassed: true },
        });
        const devices = structuredClone(importedTrack().devices);
        clearUndoHistory();

        await executeAppAction({ type: 'removeDevice', payload: { deviceId: 'retained-synth-eq' } });

        expect(importedTrack().devices).toEqual([synth]);
        expect(audioEngine.getTrackStrip(track.id)?.deviceNodes).toEqual([]);
        await undo();
        expect(importedTrack().devices).toEqual(devices);
        const restoredNodes = audioEngine.getTrackStrip(track.id)?.deviceNodes;
        expect(restoredNodes?.map((device) => device.deviceId)).toEqual(['retained-synth-eq']);
        expect(restoredNodes?.[0]).toMatchObject({ bypassed: true });
        expect(restoredNodes?.[0]?.nodes[1]).toHaveProperty('frequency.value', 2400);
        await redo();
        expect(importedTrack().devices).toEqual([synth]);
        expect(audioEngine.getTrackStrip(track.id)?.deviceNodes).toEqual([]);
        expect(notifyUser).not.toHaveBeenCalled();
    });

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
        // The default Synth is voiced per note into the strip, without a persistent device node.
        expect(audioEngine.getTrackStrip(track.id)?.deviceNodes).toEqual([]);
        await redo();
        expect(importedTrack().devices).toEqual([]);
        expect(audioEngine.getTrackStrip(track.id)?.deviceNodes).toEqual([]);
        expect(notifyUser).not.toHaveBeenCalled();
    });
    it('keeps an initialization rejection as a committed action failure and sends no parameters', async () => {
        await importMidiFile(new File([], 'small.mid'), { shouldContinue: () => true });
        const track = importedTrack();
        expect(audioEngine.getTrackStrip(track.id)).toBeUndefined();
        const initialize = vi.spyOn(audioEngine, 'initializeTrackStripFromSnapshot').mockReturnValue({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'injected current-revision refusal',
        });
        const parameters = vi.spyOn(audioEngine, 'updateDeviceParam');
        await expect(
            executeAppAction({
                type: 'addDevice',
                payload: { trackId: track.id, deviceType: 'builtin-eq', deviceId: 'added-eq' },
            })
        ).rejects.toMatchObject({ name: 'AppActionCommittedError' });
        expect(importedTrack().devices.map((device) => device.id)).toContain('added-eq');
        expect(audioEngine.getTrackStrip(track.id)).toBeUndefined();
        expect(initialize).toHaveBeenCalled();
        expect(parameters).not.toHaveBeenCalled();
    });

    it('refuses an existing mismatched source without reinitializing or replacing its live chain', async () => {
        await importMidiFile(new File([], 'small.mid'), { shouldContinue: () => true });
        const track = importedTrack();
        const synth = track.devices[0]!;
        const snapshot = compileTrackStripInitializationSnapshot(track, [track]);
        expect(snapshot).not.toBeNull();
        // Construct the divergent live fixture, then restore the production authority check.
        configureRuntimeGraphTopologyValidator(null);
        const initialized = audioEngine.initializeTrackStripFromSnapshot({
            ...snapshot,
            nodes: [
                {
                    id: track.id,
                    kind: 'midi',
                    devices: [{ id: 'foreign-live-device', type: 'builtin-eq', parameterIds: [] }],
                },
            ],
        });
        expect(initialized).toMatchObject({ acceptance: 'accepted', application: 'applied' });
        configureRuntimeGraphTopologyValidator(runtimeGraphTopology.matchesCurrentProject);
        const initialize = vi.spyOn(audioEngine, 'initializeTrackStripFromSnapshot');
        await expect(executeAppAction({ type: 'removeDevice', payload: { deviceId: synth.id } })).rejects.toMatchObject(
            { name: 'AppActionCommittedError' }
        );
        expect(initialize).not.toHaveBeenCalled();
        expect(audioEngine.getTrackStrip(track.id)?.deviceNodes.map((device) => device.deviceId)).toEqual([
            'foreign-live-device',
        ]);
    });
    it('initializes only the authoritative final chain for a cold consecutive batch', async () => {
        await importMidiFile(new File([], 'small.mid'), { shouldContinue: () => true });
        const track = importedTrack();
        expect(audioEngine.getTrackStrip(track.id)).toBeUndefined();
        const initialize = vi.spyOn(audioEngine, 'initializeTrackStripFromSnapshot');
        const result = await executeAppActionBatch([
            { type: 'removeDevice', payload: { deviceId: track.devices[0]!.id } },
            { type: 'addDevice', payload: { trackId: track.id, deviceType: 'builtin-eq', deviceId: 'final-eq' } },
        ]);
        expect(result.status).toBe('committed');
        expect(initialize).toHaveBeenCalledTimes(1);
        expect(initialize.mock.calls[0]?.[0]).toMatchObject({
            nodes: [expect.objectContaining({ devices: [expect.objectContaining({ id: 'final-eq' })] })],
        });
        expect(audioEngine.getTrackStrip(track.id)?.deviceNodes.map((device) => device.deviceId)).toEqual(['final-eq']);
        expect(importedTrack().devices.map((device) => device.id)).toEqual(['final-eq']);
    });

    it('composes grouped device restorations through the same authoritative final chain', async () => {
        await importMidiFile(new File([], 'small.mid'), { shouldContinue: () => true });
        const track = importedTrack();
        await executeAppAction({ type: 'removeDevice', payload: { deviceId: track.devices[0]!.id } });
        const setup = await executeAppActionBatch([
            { type: 'addDevice', payload: { trackId: track.id, deviceType: 'builtin-eq', deviceId: 'eq-one' } },
            { type: 'addDevice', payload: { trackId: track.id, deviceType: 'builtin-eq', deviceId: 'eq-two' } },
        ]);
        expect(setup.status).toBe('committed');
        const devices = structuredClone(importedTrack().devices);
        clearUndoHistory();
        const removed = await executeAppActionBatch(
            devices.map((device) => ({ type: 'removeDevice' as const, payload: { deviceId: device.id } })),
            { groupId: 'remove-eq-pair' }
        );
        expect(removed.status).toBe('committed');
        expect(audioEngine.getTrackStrip(track.id)?.deviceNodes).toEqual([]);
        await undo();
        expect(importedTrack().devices).toEqual(devices);
        expect(audioEngine.getTrackStrip(track.id)?.deviceNodes.map((device) => device.deviceId)).toEqual(
            devices.map((device) => device.id)
        );
        await redo();
        expect(importedTrack().devices).toEqual([]);
        expect(audioEngine.getTrackStrip(track.id)?.deviceNodes).toEqual([]);
    });

    it('restores the committed EQ controls when undo also reverses an earlier edit in the removal group', async () => {
        await importMidiFile(new File([], 'small.mid'), { shouldContinue: () => true });
        const track = importedTrack();
        await executeAppAction({ type: 'removeDevice', payload: { deviceId: track.devices[0]!.id } });
        await executeAppAction({
            type: 'addDevice',
            payload: { trackId: track.id, deviceType: 'builtin-eq', deviceId: 'grouped-eq' },
        });
        const original = structuredClone(importedTrack().devices.find((device) => device.id === 'grouped-eq'));
        expect(original?.parameterValues['eq-mid-freq']).toBe(1000);
        clearUndoHistory();
        await executeAppAction(
            { type: 'setDeviceParameter', payload: { deviceId: 'grouped-eq', paramId: 'eq-mid-freq', value: 2400 } },
            { groupId: 'edit-and-remove-eq' }
        );
        await executeAppAction(
            { type: 'removeDevice', payload: { deviceId: 'grouped-eq' } },
            { groupId: 'edit-and-remove-eq' }
        );
        expect(importedTrack().devices.some((device) => device.id === 'grouped-eq')).toBe(false);
        const parameters = vi.spyOn(audioEngine, 'updateDeviceParam');

        await undo();

        expect(importedTrack().devices.find((device) => device.id === 'grouped-eq')).toEqual(original);
        expect(audioEngine.getTrackStrip(track.id)?.deviceNodes.map((device) => device.deviceId)).toContain(
            'grouped-eq'
        );
        const frequencyWrites = parameters.mock.calls.filter(
            ([trackId, deviceId, parameterId]) =>
                trackId === track.id && deviceId === 'grouped-eq' && parameterId === 'eq-mid-freq'
        );
        expect(frequencyWrites.length).toBeGreaterThan(0);
        expect(frequencyWrites.at(-1)?.[3]).toBe(1000);
        expect(frequencyWrites.every(([, , , value]) => value === 1000)).toBe(true);
        const restoredNode = audioEngine
            .getTrackStrip(track.id)
            ?.deviceNodes.find((device) => device.deviceId === 'grouped-eq');
        expect(restoredNode?.nodes[1]).toHaveProperty('frequency.value', 1000);

        await redo();
        expect(importedTrack().devices.some((device) => device.id === 'grouped-eq')).toBe(false);
        expect(audioEngine.getTrackStrip(track.id)?.deviceNodes.map((device) => device.deviceId)).not.toContain(
            'grouped-eq'
        );
        expect(notifyUser).not.toHaveBeenCalled();
    });
});
