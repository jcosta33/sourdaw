import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import {
    applyRuntimeGraphDelta,
    getRuntimeGraphRevision,
    configureRuntimeGraphTopologyValidator,
    getTrackStrip,
    removeTrackStrip,
    waitForDevices,
    updateDeviceParam,
} from '#/modules/AudioEngine/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction, redo, undo } from '#/modules/Command/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { createTrack } from '../../../models/Track';
import { trackStore } from '../../../stores/trackStore';
import { compileAddDeviceAction } from '../../../useCases/device/compileAddDeviceAction';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';
import { projectTrackToLiveStrip } from '../../../useCases/projectTrackToLiveStrip';
import { runtimeGraphTopology } from '../../../useCases/runtimeGraphTopology';

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

const audio = await vi.hoisted(async () => {
    const { createMockAudioContext } = await import('../../../../../helpers/__tests__/audioContext.mock');
    const context = createMockAudioContext();
    vi.stubGlobal(
        'AudioContext',
        class {
            constructor() {
                return context;
            }
        }
    );
    class ControlledWorkletNode {
        connectedTo: AudioNode[] = [];
        parameters = new Map<string, AudioParam>();
        numberOfInputs = 1;
        port = {
            onmessage: null as ((event: MessageEvent) => void) | null,
            postMessage: vi.fn((message: { type?: string }) => {
                if (message.type === 'init') {
                    queueMicrotask(() =>
                        this.port.onmessage?.(new MessageEvent('message', { data: { type: 'ready', latency: 0 } }))
                    );
                }
            }),
            close: vi.fn(),
        };
        connect = vi.fn((destination: AudioNode) => {
            this.connectedTo.push(destination);
            return destination;
        });
        disconnect = vi.fn(() => {
            this.connectedTo = [];
        });
        constructor(
            public context: BaseAudioContext,
            public name: string
        ) {}
    }
    vi.stubGlobal('AudioWorkletNode', ControlledWorkletNode);
    vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(new Response(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))))
    );
    return { context, ControlledWorkletNode };
});

function projectTrack() {
    const track = trackStore.value?.tracks[0];
    if (!track) {
        throw new Error('Missing project MIDI track');
    }
    return track;
}

describe('registered MIDI device actions with real AudioEngine and TrackNode', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        const track = createTrack({ id: 'midi-topology', kind: 'midi', name: 'MIDI' });
        trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
        flushAutomergeStorageWrites();
        configureRuntimeGraphTopologyValidator(runtimeGraphTopology.matchesCurrentProject);
        expect(projectTrack().devices.map((device) => device.type)).toEqual(['builtin-synth']);
    });

    afterEach(() => {
        removeTrackStrip('midi-topology');
        clearUndoHistory();
        clearHandlerRegistry();
        configureRuntimeGraphTopologyValidator(null);
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        flushAutomergeStorageWrites();
    });

    it.each(['cold', 'Play-before-add'] as const)(
        '%s Crust add/Undo/Redo preserves project and live chain',
        async (state) => {
            if (state === 'Play-before-add') {
                // Play and project-open both call this exact initialization route.
                expect(projectTrackToLiveStrip({ trackId: 'midi-topology' })).toMatchObject({
                    acceptance: 'accepted',
                    application: 'applied',
                });
                expect(getTrackStrip('midi-topology')?.deviceNodes).toEqual([]);
            }
            const synthId = projectTrack().devices[0]?.id;
            const action = compileAddDeviceAction('midi-topology', 'crust');
            if (!action) {
                throw new Error('Missing compiled Crust insertion');
            }
            expect(action.payload.expectedDeviceIds).toEqual([synthId]);
            await expect(executeAppAction(action)).resolves.toBeUndefined();
            expect(projectTrack().devices.map((device) => device.type)).toEqual(['builtin-synth', 'crust']);
            const insertedWorklet = await assertConnectedCrust();
            expect(undoStore.value?.past).toHaveLength(1);
            await undo();
            expect(projectTrack().devices.map((device) => device.id)).toEqual([synthId]);
            expect(getTrackStrip('midi-topology')?.deviceNodes).toEqual([]);
            expect(insertedWorklet.connectedTo).toEqual([]);
            expect(insertedWorklet.port.close).toHaveBeenCalled();
            expect(undoStore.value?.future).toHaveLength(1);
            await redo();
            expect(projectTrack().devices.map((device) => device.type)).toEqual(['builtin-synth', 'crust']);
            const restoredWorklet = await assertConnectedCrust();
            expect(restoredWorklet).not.toBe(insertedWorklet);
            expect(audio.context.createGain).toHaveBeenCalled();
            expect(notifyUser).not.toHaveBeenCalled();
        }
    );

    it.each(['builtin-drum-kit', 'drum-kit', 'builtin-drum-machine-808'])(
        '%s stays project-only beside a node-backed effect',
        async (type) => {
            const track = projectTrack();
            trackStore.set({
                tracks: [{ ...track, devices: [{ ...track.devices[0]!, type }] }],
                selectedTrackId: track.id,
            });
            const action = compileAddDeviceAction(track.id, 'builtin-eq');
            if (!action) {
                throw new Error('Missing effect action');
            }
            await executeAppAction(action);
            expect(projectTrack().devices.map((device) => device.type)).toEqual([type, 'builtin-eq']);
            expect(getTrackStrip(track.id)?.deviceNodes.map((device) => device.type)).toEqual(['builtin-eq']);
            await undo();
            expect(getTrackStrip(track.id)?.deviceNodes).toEqual([]);
            await redo();
            expect(getTrackStrip(track.id)?.deviceNodes.map((device) => device.type)).toEqual(['builtin-eq']);
        }
    );

    it('rejects an old engine revision after add/Undo returns the live chain to the same topology', async () => {
        expect(projectTrackToLiveStrip({ trackId: 'midi-topology' })).toMatchObject({
            acceptance: 'accepted',
            application: 'applied',
        });
        const before = runtimeGraphTopology.createWebAudioNode(projectTrack());
        const appRevision = getRuntimeGraphRevision();
        const action = compileAddDeviceAction('midi-topology', 'crust');
        if (!action) {
            throw new Error('Missing Crust action');
        }
        await executeAppAction(action);
        const after = runtimeGraphTopology.createWebAudioNode(projectTrack());
        await assertConnectedCrust();
        await undo();
        expect(runtimeGraphTopology.createWebAudioNode(projectTrack())).toEqual(before);
        expect(getTrackStrip('midi-topology')?.deviceNodes).toEqual([]);
        expect(
            applyRuntimeGraphDelta({
                schemaVersion: 1,
                command: 'replace-track-device-chain',
                operation: 'add-device',
                correlation: { appRevision, projectRevision: captureProjectRevision() },
                before,
                after,
                parameters: [],
            })
        ).toEqual({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'Runtime graph delta is stale for the live engine revision',
        });
    });

    it('rejects a real node-backed identity mismatch after the project replaced its device', async () => {
        const track = projectTrack();
        const effect = { id: 'old-eq', type: 'builtin-eq', name: 'EQ', bypassed: false, parameterValues: {} };
        trackStore.set({ tracks: [{ ...track, devices: [...track.devices, effect] }], selectedTrackId: track.id });
        expect(projectTrackToLiveStrip({ trackId: track.id })).toMatchObject({
            acceptance: 'accepted',
            application: 'applied',
        });
        const current = projectTrack();
        trackStore.set({
            tracks: [{ ...current, devices: [current.devices[0]!, { ...effect, id: 'replacement-eq' }] }],
            selectedTrackId: current.id,
        });
        const action = compileAddDeviceAction(track.id, 'crust');
        if (!action) {
            throw new Error('Missing compiled action');
        }
        await expect(executeAppAction(action)).rejects.toMatchObject({ name: 'AppActionCommittedError' });
        expect(getTrackStrip(track.id)?.deviceNodes.map((device) => device.deviceId)).toEqual(['old-eq']);
    });
});

async function assertConnectedCrust(): Promise<InstanceType<typeof audio.ControlledWorkletNode>> {
    await waitForDevices();
    const strip = getTrackStrip('midi-topology');
    expect(strip?.deviceNodes.map((device) => device.type)).toEqual(['crust']);
    const device = strip?.deviceNodes[0];
    expect(device?.controller?.ready).toBe(true);
    const worklet = device?.inputNode;
    if (!(worklet instanceof audio.ControlledWorkletNode)) {
        throw new Error('Crust did not load its real worklet wrapper');
    }
    expect(worklet.name).toBe('crust-processor');
    expect(worklet.connectedTo.length).toBeGreaterThan(0);
    expect(strip?.gainNode.connect).toHaveBeenCalledWith(worklet);
    const crustId = projectTrack().devices.find((candidate) => candidate.type === 'crust')?.id;
    if (!crustId) {
        throw new Error('Crust identity absent');
    }
    updateDeviceParam('midi-topology', crustId, 'ceiling', -3);
    expect(worklet.port.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
            command: 'set-fallback-param',
            target: expect.objectContaining({ deviceId: crustId, parameterId: 'ceiling' }),
            value: -3,
        })
    );
    return worklet;
}
