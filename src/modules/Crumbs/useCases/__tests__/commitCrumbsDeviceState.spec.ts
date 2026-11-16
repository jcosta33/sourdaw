import { describe, expect, it, vi } from 'vitest';

const { mockCrumbsStore, mockEpisodeExecute } = vi.hoisted(() => ({
    mockCrumbsStore: { value: null as Record<string, { mode: string; activeSample: unknown }> | null },
    mockEpisodeExecute: vi.fn().mockResolvedValue(undefined),
}));

const episodes = { execute: mockEpisodeExecute, end: vi.fn(), endAll: vi.fn() };

vi.mock('#/modules/Command/useCases', () => ({
    createUserAppActionRefusalEpisodes: vi.fn(() => episodes),
    describeAppActionRefusal: vi.fn(),
    executeAppAction: vi.fn(),
    executeUserAppAction: vi.fn(),
}));
vi.mock('../../stores/crumbsStore', () => ({ crumbsStore: mockCrumbsStore }));

import { commitCrumbsDeviceState } from '../commitCrumbsDeviceState';

describe('commitCrumbsDeviceState', () => {
    it('does nothing when the device has no state in the store', () => {
        mockCrumbsStore.value = {};
        commitCrumbsDeviceState('device-missing', episodes);
        expect(mockEpisodeExecute).not.toHaveBeenCalled();
    });

    it('does nothing when the store value is null', () => {
        mockCrumbsStore.value = null;
        commitCrumbsDeviceState('any-device', episodes);
        expect(mockEpisodeExecute).not.toHaveBeenCalled();
    });

    it('dispatches setDeviceState with mode and activeSample when the device is found', () => {
        mockCrumbsStore.value = {
            'device-1': { mode: 'slicer', activeSample: { id: 'sample-1', name: 'Kick' } },
        };
        vi.clearAllMocks();
        mockCrumbsStore.value = {
            'device-1': { mode: 'slicer', activeSample: { id: 'sample-1', name: 'Kick' } },
        };
        commitCrumbsDeviceState('device-1', episodes);
        expect(mockEpisodeExecute).toHaveBeenCalledTimes(1);
        const [key, action, options] = mockEpisodeExecute.mock.calls[0]!;
        expect(key).toBe('device-1');
        expect(action.type).toBe('setDeviceState');
        expect(action.payload.deviceId).toBe('device-1');
        expect(action.payload.state).toBeDefined();
        expect(options).toEqual({ skipMacroRecording: true });
    });
});
