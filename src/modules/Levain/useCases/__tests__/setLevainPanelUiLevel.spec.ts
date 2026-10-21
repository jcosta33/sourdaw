import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    trackStore: {
        value: {
            tracks: [] as {
                devices: {
                    id: string;
                    type: string;
                    parameterValues: Record<string, number>;
                    deviceState?: { version: number; data: Record<string, string> };
                }[];
            }[],
        },
    },
    executeUserAppAction: vi.fn(async (_action: unknown) => {}),
    notifyUser: vi.fn(),
}));
vi.mock('#/modules/Arrangement/stores', () => ({ trackStore: mocks.trackStore }));
vi.mock('#/modules/Command/useCases', () => ({ executeUserAppAction: mocks.executeUserAppAction }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));

import { defaultLevainState, levainStore } from '../../stores/levainStore';
import { setLevainPanelUiLevel } from '../setLevainPanelUiLevel';
import { reconcileLevainDeviceStateFromProject } from '../reconcileLevainDeviceStateFromProject';
import { hydrateLevainStateFromDevice } from '../hydrateLevainStateFromDevice';

vi.mock('../loadPreset', () => ({ loadInstrument: vi.fn() }));
vi.mock('../levainParamBridge/setLevainParamWithAudio', () => ({ setLevainParamWithAudio: vi.fn() }));

describe('setLevainPanelUiLevel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.executeUserAppAction.mockImplementation(async () => {});
        mocks.trackStore.value = {
            tracks: [
                {
                    devices: ['a', 'b'].map((id) => ({
                        id,
                        type: 'levain',
                        parameterValues: {},
                        deviceState: { version: 1, data: { instrumentId: 'violin-1', currentArticulation: 'sustain' } },
                    })),
                },
            ],
        };
        levainStore.set({ a: { ...defaultLevainState }, b: { ...defaultLevainState } });
    });

    it('requests a typed addressed chunk preserving identity and paints only authoritative projection', async () => {
        await setLevainPanelUiLevel('a', 6);
        expect(mocks.executeUserAppAction).toHaveBeenCalledWith(
            {
                type: 'setDeviceState',
                payload: {
                    deviceId: 'a',
                    state: {
                        version: 1,
                        data: {
                            instrumentId: 'violin-1',
                            currentArticulation: 'sustain',
                            disclosureTier: 'expert',
                        },
                    },
                },
            },
            { skipMacroRecording: true }
        );
        expect(levainStore.value?.a?.uiLevel).toBe(1);
        const patch = levainStore.value?.a?.patch;
        const device = mocks.trackStore.value.tracks[0]!.devices[0]!;
        device.deviceState!.data.disclosureTier = 'expert';
        reconcileLevainDeviceStateFromProject('a');
        expect(levainStore.value?.a?.uiLevel).toBe(6);
        expect(levainStore.value?.b?.uiLevel).toBe(1);
        expect(hydrateLevainStateFromDevice(device).uiLevel).toBe(6);
        device.deviceState!.data.disclosureTier = 'basic';
        reconcileLevainDeviceStateFromProject('a');
        expect(levainStore.value?.a?.uiLevel).toBe(1);
        expect(levainStore.value?.a?.patch).toBe(patch);
    });

    it('does not paint a refused write after its void promise resolves', async () => {
        const before = levainStore.value;
        const projectBefore = mocks.trackStore.value;
        await setLevainPanelUiLevel('a', 6);
        reconcileLevainDeviceStateFromProject('a');
        expect(levainStore.value).toBe(before);
        expect(mocks.trackStore.value).toBe(projectBefore);
        expect(mocks.trackStore.value.tracks[0]!.devices[0]!.deviceState!.data.disclosureTier).toBeUndefined();
    });

    it('does not paint after a refused or stale request completes', async () => {
        const before = levainStore.value;
        mocks.executeUserAppAction.mockImplementation(async () => {
            mocks.trackStore.value = { tracks: [] };
        });
        await setLevainPanelUiLevel('a', 6);
        reconcileLevainDeviceStateFromProject('a');
        expect(levainStore.value).toBe(before);
        await setLevainPanelUiLevel('a', 6);
        expect(mocks.executeUserAppAction).toHaveBeenCalledTimes(1);
    });

    it('refuses an unknown version and never overwrites it', async () => {
        mocks.trackStore.value.tracks[0]!.devices[0]!.deviceState!.version = 2;
        await setLevainPanelUiLevel('a', 6);
        expect(mocks.executeUserAppAction).not.toHaveBeenCalled();
        expect(levainStore.value?.a?.uiLevel).toBe(1);
        expect(mocks.notifyUser).toHaveBeenCalled();
    });

    it('hydrates legacy chunks as Basic', () => {
        expect(hydrateLevainStateFromDevice(mocks.trackStore.value.tracks[0]!.devices[0]!).uiLevel).toBe(1);
    });
});
