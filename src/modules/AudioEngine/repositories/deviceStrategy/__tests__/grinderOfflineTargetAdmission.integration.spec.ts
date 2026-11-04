import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState, trackStore } from '#/modules/Arrangement/stores';
import { createTrack, getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction } from '#/modules/Command/useCases';

import {
    createReadyGrinderProcessor,
    grinderSetParamCalls,
    resetGrinderProcessorCalls,
} from '../../../services/__tests__/grinderProcessorTestHarness';
import { createNativeDspStrategy } from '../NativeDspDeviceStrategy';

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    updateDeviceParam: vi.fn(),
}));

vi.mock('#/infra/audioWorklet/workletInitShared', () => ({
    ensureWorkletRegistered: vi.fn().mockResolvedValue(undefined),
    fetchWasmModule: vi.fn().mockResolvedValue({
        module: new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])),
        commit: vi.fn(),
        release: vi.fn(),
    }),
    createReadyHandshake: vi.fn(() => ({
        promise: Promise.resolve({}),
        onMessage: () => 'other' as const,
        isSettled: () => true,
    })),
}));

vi.mock('../../../engine/telemetryAllocator', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../engine/telemetryAllocator')>()),
    telemetryAllocator: { allocateSlot: vi.fn(() => null), releaseSlot: vi.fn() },
}));

describe('saved Grinder parameter admission into the offline control target', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        clearHandlerRegistry();
        registerHandlerMap({ setDeviceParameter: getArrangementHandlers().setDeviceParameter });
        clearUndoHistory();
        resetGrinderProcessorCalls();
        vi.stubGlobal('currentFrame', 0);
        vi.stubGlobal('sampleRate', 48_000);
    });

    afterEach(() => {
        clearUndoHistory();
        clearHandlerRegistry();
        trackStore.set(defaultTrackState);
        configureAutomergeStoragePort(null);
        vi.unstubAllGlobals();
    });

    it.each(['', 'x'.repeat(129)])(
        'replays valid controls when a saved key is outside the protocol: %j',
        async (key) => {
            const track = createTrack({ id: 'track-1', name: 'Guitar', kind: 'audio' });
            track.devices = [
                { id: 'grinder-1', name: 'Grinder', type: 'grinder', bypassed: false, parameterValues: {} },
            ];
            trackStore.set({ ...defaultTrackState, tracks: [track] });

            // The real command admits numeric extension parameters into the project.
            // An unsupported runtime ID must not poison the rest of this saved record.
            for (const [paramId, value] of [
                [key, 0.7],
                ['neuralCustomOutputTrim', 0.2],
                ['y'.repeat(128), 0.4],
            ] as const) {
                await executeAppAction({
                    type: 'setDeviceParameter',
                    payload: { deviceId: 'grinder-1', paramId, value },
                });
            }
            const savedDevice = trackStore.value?.tracks[0]?.devices[0];
            expect(savedDevice?.parameterValues).toEqual({
                [key]: 0.7,
                neuralCustomOutputTrim: 0.2,
                ['y'.repeat(128)]: 0.4,
            });
            if (!savedDevice) {
                throw new Error('The parameter command did not preserve its device');
            }

            // WASM records setter calls behind the real strategy, node sender,
            // compiler, and processor admission; this does not assert PCM output.
            const processor = await createReadyGrinderProcessor();
            expect(processor.port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'ready' }));
            const postMessage = vi.fn((data: unknown) => processor.port.onmessage?.({ data }));
            class OfflineContext {
                currentTime = 0;
                sampleRate = 48_000;
            }
            class WorkletNode {
                port = { postMessage, onmessage: null, close: vi.fn() };
                parameters = new Map<string, AudioParam>();
                disconnect = vi.fn();
            }
            vi.stubGlobal('AudioContext', class {});
            vi.stubGlobal('OfflineAudioContext', OfflineContext);
            vi.stubGlobal('AudioWorkletNode', WorkletNode);
            const requestFrame = vi.fn();
            vi.stubGlobal('requestAnimationFrame', requestFrame);

            const strategy = await createNativeDspStrategy(new OfflineContext() as BaseAudioContext, savedDevice);

            expect(grinderSetParamCalls).toEqual([
                { name: 'neuralCustomOutputTrim', value: 0.2 },
                { name: 'y'.repeat(128), value: 0.4 },
            ]);
            expect(postMessage).toHaveBeenCalledWith({
                schemaVersion: 1,
                command: 'initialize-fallback-control',
                target: {
                    trackId: 'offline-grinder-track',
                    deviceId: 'grinder-1',
                    deviceType: 'grinder',
                    parameterIds: ['neuralCustomOutputTrim', 'y'.repeat(128), 'bypass'],
                },
                correlation: { workletGeneration: expect.any(Number) },
            });
            expect(savedDevice.parameterValues[key]).toBe(0.7);
            expect(requestFrame).not.toHaveBeenCalled();
            strategy.destroy();
        }
    );
});
