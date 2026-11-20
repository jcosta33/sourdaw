import { describe, expect, it, vi } from 'vitest';

const { mockToasterStore, mockEpisodeExecute } = vi.hoisted(() => ({
    mockToasterStore: { value: null as Record<string, { kit: unknown }> | null },
    mockEpisodeExecute: vi.fn().mockResolvedValue(undefined),
}));

const episodes = { execute: mockEpisodeExecute, end: vi.fn(), endAll: vi.fn() };

vi.mock('#/modules/Command/useCases', () => ({
    createUserAppActionRefusalEpisodes: vi.fn(() => episodes),
    describeAppActionRefusal: vi.fn(),
    executeAppAction: vi.fn(),
    executeUserAppAction: vi.fn(),
}));
vi.mock('../../stores/toasterStore', () => ({ toasterStore: mockToasterStore }));

import { commitToasterKit } from '../commitToasterKit';

const sampleKit = {
    pads: [{ name: 'Kick', engineType: 'synth', sample: null }],
};

describe('commitToasterKit', () => {
    it('does nothing when the device has no kit in the store', () => {
        mockToasterStore.value = {};
        commitToasterKit('device-missing', episodes);
        expect(mockEpisodeExecute).not.toHaveBeenCalled();
    });

    it('does nothing when the store value is null', () => {
        mockToasterStore.value = null;
        commitToasterKit('any-device', episodes);
        expect(mockEpisodeExecute).not.toHaveBeenCalled();
    });

    it('dispatches setDeviceState with the serialized kit when the device is found', () => {
        mockToasterStore.value = { 'device-1': { kit: sampleKit } };
        vi.clearAllMocks();
        commitToasterKit('device-1', episodes);
        expect(mockEpisodeExecute).toHaveBeenCalledTimes(1);
        const [key, action, options] = mockEpisodeExecute.mock.calls[0]!;
        expect(key).toBe('device-1');
        expect(action.type).toBe('setDeviceState');
        expect(action.payload.deviceId).toBe('device-1');
        expect(action.payload.state).toBeDefined();
        expect(options.skipMacroRecording).toBe(true);
        expect(options.shouldExecute()).toBe(true);
        mockToasterStore.value = { 'device-1': { kit: structuredClone(sampleKit) } };
        expect(options.shouldExecute()).toBe(false);
    });
});
