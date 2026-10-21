import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    executeAppAction: vi.fn(),
    trackStore: { value: { tracks: [] as { devices: { id: string; type: string; deviceState?: { version: number; data: Record<string, string> } }[] }[] } },
}));
vi.mock('#/modules/Command/useCases', () => ({ executeAppAction: mocks.executeAppAction }));
vi.mock('#/modules/Arrangement/stores', () => ({ trackStore: mocks.trackStore }));

import { createDefaultPatch } from '../../models/LevainPatch';
import { defaultLevainState, levainStore } from '../../stores/levainStore';
import { commitLevainDeviceState } from '../commitLevainDeviceState';

describe('commitLevainDeviceState', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        levainStore.set({ a: { ...defaultLevainState, patch: createDefaultPatch('cello') } });
        mocks.trackStore.value = { tracks: [{ devices: [{ id: 'a', type: 'levain', deviceState: {
            version: 1, data: { instrumentId: 'violin-1', currentArticulation: 'sustain', disclosureTier: 'expert' },
        } }] }] };
    });

    it('carries the current peer tier through an identity write even before its session projection', () => {
        commitLevainDeviceState('a');
        expect(mocks.executeAppAction).toHaveBeenCalledWith({ type: 'setDeviceState', payload: {
            deviceId: 'a', state: { version: 1, data: { instrumentId: 'cello', currentArticulation: 'sustain', disclosureTier: 'expert' } },
        } }, { skipMacroRecording: true });
    });

    it('does not echo already projected identity or overwrite unknown versions', () => {
        mocks.trackStore.value.tracks[0]!.devices[0]!.deviceState!.data.instrumentId = 'cello';
        commitLevainDeviceState('a');
        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        mocks.trackStore.value.tracks[0]!.devices[0]!.deviceState!.version = 2;
        commitLevainDeviceState('a');
        expect(mocks.executeAppAction).not.toHaveBeenCalled();
    });

    it('does not resurrect missing project or session devices', () => {
        commitLevainDeviceState('missing');
        mocks.trackStore.value = { tracks: [] };
        commitLevainDeviceState('a');
        expect(mocks.executeAppAction).not.toHaveBeenCalled();
    });
});
