/**
 * A Toaster removed while its engine is still loading must take the edits
 * queued in that window with it.
 *
 * The panel mounts as soon as the device sits on its track, so a kit write or a
 * pad selection can land before registration creates the store record; the
 * store queues both for registration. Only the engine's removal notification
 * discards them. This drives the real removal path — a runtime graph delta that
 * removes the device from the live engine, the engine's removal notification,
 * and this module's subscriber — then registers the same id again, as undoing
 * the removal and letting the device load does.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockAudioContext } from '#/helpers/__tests__/audioContext.mock';
import { createMock } from '#/infra/di/testing/createMock';
import { type Logger } from '#/infra/logger/types';
import {
    applyRuntimeGraphDelta,
    configureAudioDeviceRuntimeSink,
    getAudioContext,
    getRuntimeGraphRevision,
    resetAudioGraph,
} from '#/modules/AudioEngine/useCases';

import {
    defaultToasterState,
    resetToasterDeviceLifecycleState,
    selectPad,
    toasterStore,
    updateKit,
} from '../../stores/toasterStore';
import { initToasterSubscribers } from '../toasterSubscriber';

const arrangementMocks = vi.hoisted(() => ({ resolveEligibleDeviceWriteTarget: vi.fn() }));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    resolveEligibleDeviceWriteTarget: arrangementMocks.resolveEligibleDeviceWriteTarget,
}));

type LifecycleEvent = 'audioDevice.loaded' | 'audioDevice.removed';
type LifecyclePayload = { deviceId: string; deviceType: string };
type LifecycleHandler = (payload: LifecyclePayload) => void;

class FakeWorkletNode {
    port = { postMessage: vi.fn(), close: vi.fn() };
    connect = vi.fn();
    disconnect = vi.fn();
}

const TRACK_ID = 'track-1';
const DEVICE_ID = 'toast-1';
const toasterDevice = { id: DEVICE_ID, type: 'toaster', parameterIds: [] };
const gainDevice = { id: 'gain-1', type: 'builtin-gain', parameterIds: [] };

/** The app's event bus reduced to the two lifecycle events, emitting synchronously. */
function createLifecycleBus(): {
    on: (event: LifecycleEvent, handler: LifecycleHandler) => () => void;
    emit: (event: LifecycleEvent, payload: LifecyclePayload) => void;
} {
    const handlers: Record<LifecycleEvent, Set<LifecycleHandler>> = {
        'audioDevice.loaded': new Set(),
        'audioDevice.removed': new Set(),
    };
    return {
        on: (event, handler) => {
            handlers[event].add(handler);
            return () => {
                handlers[event].delete(handler);
            };
        },
        emit: (event, payload) => {
            for (const handler of handlers[event]) {
                handler(payload);
            }
        },
    };
}

type ChainDevice = typeof toasterDevice;
type ChainOperation = 'add-device' | 'remove-device' | 'replace-device-chain';

function applyChain(operation: ChainOperation, before: readonly ChainDevice[], after: readonly ChainDevice[]): void {
    const result = applyRuntimeGraphDelta({
        schemaVersion: 1,
        command: 'replace-track-device-chain',
        correlation: { appRevision: getRuntimeGraphRevision(), projectRevision: 'project-revision-1' },
        operation,
        before: { id: TRACK_ID, kind: 'midi', devices: before },
        after: { id: TRACK_ID, kind: 'midi', devices: after },
        parameters: [],
    });
    expect(result).toMatchObject({ acceptance: 'accepted', application: 'applied' });
}

function applyToasterChain(operation: 'add-device' | 'remove-device'): void {
    if (operation === 'add-device') {
        applyChain(operation, [], [toasterDevice]);
        return;
    }
    applyChain(operation, [toasterDevice], []);
}

/** The load the engine never finishes in this spec, announced as the engine would. */
function finishToasterLoad(bus: ReturnType<typeof createLifecycleBus>): void {
    bus.emit('audioDevice.loaded', { deviceId: DEVICE_ID, deviceType: 'toaster' });
}

describe('Toaster removed while its engine is still loading', () => {
    let bus: ReturnType<typeof createLifecycleBus>;
    let unsubscribe: () => void;

    beforeEach(() => {
        toasterStore.set({});
        resetToasterDeviceLifecycleState();
        arrangementMocks.resolveEligibleDeviceWriteTarget.mockReturnValue({
            status: 'eligible',
            trackId: TRACK_ID,
            deviceId: DEVICE_ID,
        });
        vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
        // The engine singleton was built on the global test context, which has no
        // channel-strip factories; give it a full mock context, and keep the
        // Toaster worklet module from ever registering so the device stays loading.
        const context = Object.assign(getAudioContext(), createMockAudioContext());
        vi.spyOn(context.audioWorklet, 'addModule').mockReturnValue(new Promise<void>(() => {}));

        bus = createLifecycleBus();
        configureAudioDeviceRuntimeSink({
            emitDeviceLoaded: (payload) => bus.emit('audioDevice.loaded', payload),
            emitDeviceRemoved: (payload) => bus.emit('audioDevice.removed', payload),
        });
        unsubscribe = initToasterSubscribers({ eventBus: bus, logger: createMock<Logger>() });
    });

    afterEach(() => {
        resetAudioGraph();
        unsubscribe();
        configureAudioDeviceRuntimeSink({});
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('applies nothing queued before the removal when the same id registers again', () => {
        applyToasterChain('add-device');
        updateKit(DEVICE_ID, { swing: 0.9 });
        selectPad(DEVICE_ID, 7);
        expect(toasterStore.value?.[DEVICE_ID]).toBeUndefined();

        applyToasterChain('remove-device');
        finishToasterLoad(bus);

        const registered = toasterStore.value?.[DEVICE_ID];
        expect(registered?.kit.swing).toBe(defaultToasterState.kit.swing);
        expect(registered?.selectedPadIndex).toBe(defaultToasterState.selectedPadIndex);
    });

    // A preset load or a grouped same-track batch replaces the whole chain and
    // rebuilds every slot, but a Toaster the new chain keeps never left.
    it('keeps the queued edits when a chain replacement rebuilds the loading device under its id', () => {
        applyToasterChain('add-device');
        updateKit(DEVICE_ID, { swing: 0.9 });
        selectPad(DEVICE_ID, 7);

        applyChain('replace-device-chain', [toasterDevice], [gainDevice, toasterDevice]);
        updateKit(DEVICE_ID, { masterGain: 1.5 });
        finishToasterLoad(bus);

        const registered = toasterStore.value?.[DEVICE_ID];
        expect(registered?.kit.swing).toBe(0.9);
        expect(registered?.kit.masterGain).toBe(1.5);
        expect(registered?.selectedPadIndex).toBe(7);
    });

    // The runtime-graph repair resets the graph and rebuilds the same project.
    it('keeps the queued edits when a graph repair rebuilds the loading device under its id', () => {
        applyToasterChain('add-device');
        updateKit(DEVICE_ID, { swing: 0.9 });
        selectPad(DEVICE_ID, 7);

        resetAudioGraph();
        applyToasterChain('add-device');
        updateKit(DEVICE_ID, { masterGain: 1.5 });
        finishToasterLoad(bus);

        const registered = toasterStore.value?.[DEVICE_ID];
        expect(registered?.kit.swing).toBe(0.9);
        expect(registered?.kit.masterGain).toBe(1.5);
        expect(registered?.selectedPadIndex).toBe(7);
    });
});
