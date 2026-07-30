/**
 * Device registration is the only place a Toaster store record is created.
 *
 * Every store writer (selectPad/updatePad/loadKit/updateKit/toggleStep/
 * setStepVelocity) refuses an unknown deviceId so a write arriving after
 * teardown cannot resurrect a deleted device. That guard is only correct if
 * something else creates the record first — otherwise the store is empty for
 * the whole session and every edit is a silent no-op.
 *
 * These tests drive the real store through the live registration seam
 * (`audioDevice.loaded`) and assert that an edit *survives* the round trip,
 * not merely that a writer was called.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createMock, type MockObject } from '#/infra/di/testing/createMock';
import { type Logger } from '#/infra/logger/types';

const engineMocks = vi.hoisted(() => ({
    getToasterDeviceControls: vi.fn(),
    resolveEligibleDeviceWriteTarget: vi.fn(),
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    resolveEligibleDeviceWriteTarget: engineMocks.resolveEligibleDeviceWriteTarget,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getToasterDeviceControls: engineMocks.getToasterDeviceControls,
}));

vi.mock('../disposeToasterDevice', () => ({
    disposeToasterDevice: vi.fn(),
}));

import {
    selectPad,
    toasterStore,
    toggleStep,
    unregisterToasterDevice,
    updateKit,
    updatePad,
} from '../../stores/toasterStore';
import { initToasterSubscribers } from '../toasterSubscriber';

type LifecyclePayload = { deviceId: string; deviceType: string };

type EventBusShape = {
    on: (
        event: 'audioDevice.loaded' | 'audioDevice.removed',
        handler: (payload: LifecyclePayload) => void
    ) => () => void;
};

function handlerFor(eventBus: MockObject<EventBusShape>, event: string): (payload: LifecyclePayload) => void {
    const call = eventBus.on.mock.calls.find((entry) => entry[0] === event);
    if (!call) {
        throw new Error(`no subscription registered for ${event}`);
    }
    return call[1];
}

function loadToasterDevice(deviceId: string): void {
    const eventBus = createMock<EventBusShape>();
    eventBus.on.mockReturnValue(vi.fn<() => void>());
    initToasterSubscribers({ eventBus, logger: createMock<Logger>() });
    handlerFor(eventBus, 'audioDevice.loaded')({ deviceId, deviceType: 'toaster' });
}

describe('Toaster device registration creates the store record', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        toasterStore.set({});
        engineMocks.getToasterDeviceControls.mockReturnValue({ setParam: vi.fn(), setPadParam: vi.fn() });
        engineMocks.resolveEligibleDeviceWriteTarget.mockReturnValue({
            status: 'eligible',
            trackId: 'track-1',
            deviceId: 'toast-1',
        });
    });

    it('a loaded toaster device gets a store record with a full default kit', () => {
        loadToasterDevice('toast-1');

        const state = toasterStore.value?.['toast-1'];
        expect(state?.kit.pads).toHaveLength(16);
        expect(state?.selectedPadIndex).toBe(0);
    });

    it('a pad-parameter edit survives the write and reads back changed', () => {
        loadToasterDevice('toast-1');

        updatePad('toast-1', 2, { tune: 7.5 });

        expect(toasterStore.value?.['toast-1']?.kit.pads[2]?.tune).toBe(7.5);
    });

    it('a kit-parameter edit survives the write and reads back changed', () => {
        loadToasterDevice('toast-1');

        updateKit('toast-1', { swing: 0.42 });

        expect(toasterStore.value?.['toast-1']?.kit.swing).toBe(0.42);
    });

    it('a step-grid toggle survives the write and flips the stored step', () => {
        loadToasterDevice('toast-1');
        const before = toasterStore.value?.['toast-1']?.kit.patterns[0]?.tracks[0]?.steps[0]?.active;

        toggleStep('toast-1', 0, 0);

        const after = toasterStore.value?.['toast-1']?.kit.patterns[0]?.tracks[0]?.steps[0]?.active;
        expect(typeof before).toBe('boolean');
        expect(after).toBe(!before);
    });

    it('a pad selection survives the write and reads back changed', () => {
        loadToasterDevice('toast-1');

        selectPad('toast-1', 5);

        expect(toasterStore.value?.['toast-1']?.selectedPadIndex).toBe(5);
    });

    it('re-registering an already-loaded device keeps the edits it already holds', () => {
        loadToasterDevice('toast-1');
        updateKit('toast-1', { swing: 0.31 });

        loadToasterDevice('toast-1');

        expect(toasterStore.value?.['toast-1']?.kit.swing).toBe(0.31);
    });

    it('a non-toaster device load creates no toaster record', () => {
        const eventBus = createMock<EventBusShape>();
        eventBus.on.mockReturnValue(vi.fn<() => void>());
        initToasterSubscribers({ eventBus, logger: createMock<Logger>() });

        handlerFor(eventBus, 'audioDevice.loaded')({ deviceId: 'levain-1', deviceType: 'levain' });

        expect(toasterStore.value).toEqual({});
    });

    it('an ineligible owner creates no record, so registration cannot bypass the write boundary', () => {
        engineMocks.resolveEligibleDeviceWriteTarget.mockReturnValue({ status: 'ineligible' });

        loadToasterDevice('toast-1');

        expect(toasterStore.value).toEqual({});
    });

    it('a write to a never-registered device is still refused', () => {
        updatePad('ghost', 0, { tune: 12 });
        updateKit('ghost', { swing: 0.5 });
        toggleStep('ghost', 0, 0);

        expect(toasterStore.value).toEqual({});
    });

    it('a late write after teardown is still refused and does not resurrect the device', () => {
        loadToasterDevice('toast-1');
        unregisterToasterDevice('toast-1');

        updatePad('toast-1', 0, { tune: 9 });
        updateKit('toast-1', { swing: 0.9 });

        expect(toasterStore.value?.['toast-1']).toBeUndefined();
        expect(toasterStore.value).toEqual({});
    });
});
