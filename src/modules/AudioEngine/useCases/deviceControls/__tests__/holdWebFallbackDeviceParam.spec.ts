/**
 * The door a carried built-in's tick-grid automation takes (#3893).
 *
 * `updateDeviceParam` writes the Web Audio node *and* sends the carried native
 * body; this one deliberately stops at the node, because while the session
 * carries the built-in the engine is stamping that parameter from its own queue
 * and a second, later writer would drag it backwards. What is under test is
 * that the door writes exactly one of the two halves, and only for the family
 * it exists for.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { clampDeviceParamWrite, trackStore, type Device, type Track } from '#/modules/Arrangement/stores';

import { audioEngine } from '../../../repositories/createWebAudioEngine';
import { sendNativeDeviceParameters } from '../../livePlayback/sendNativeDeviceParameters';
import { holdWebFallbackDeviceParam } from '../holdWebFallbackDeviceParam';

vi.mock('../../../repositories/createWebAudioEngine', () => ({
    audioEngine: {
        updateDeviceParam: vi.fn(),
    },
}));

vi.mock('../../livePlayback/sendNativeDeviceParameters', () => ({
    sendNativeDeviceParameters: vi.fn(async () => true),
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/Arrangement/stores')>();
    return {
        ...mod,
        clampDeviceParamWrite: vi.fn(({ value }: { value: number }) => value),
    };
});

function createDevice(overrides: Partial<Device> & { id: string }): Device {
    return { name: overrides.id, type: 'fermenter', bypassed: false, parameterValues: {}, ...overrides };
}

function projectHolding(device: Device): void {
    trackStore.set({
        tracks: [{ id: 't1', name: 'Lead', devices: [device] } as unknown as Track],
        selectedTrackId: null,
        ghostClips: [],
    });
}

describe('holdWebFallbackDeviceParam', () => {
    beforeEach(() => {
        vi.mocked(audioEngine.updateDeviceParam).mockClear();
        vi.mocked(sendNativeDeviceParameters).mockClear();
        vi.mocked(clampDeviceParamWrite).mockReset();
        vi.mocked(clampDeviceParamWrite).mockImplementation(({ value }) => value);
        projectHolding(createDevice({ id: 'd1', type: 'fermenter' }));
    });

    afterEach(() => {
        trackStore.set(null);
    });

    it('writes the built-in’s Web Audio node the value the law allowed, and sends nothing natively', () => {
        vi.mocked(clampDeviceParamWrite).mockReturnValue(1);

        holdWebFallbackDeviceParam('t1', 'd1', 'cutoff', 4.2);

        expect(clampDeviceParamWrite).toHaveBeenCalledWith({ deviceId: 'd1', paramId: 'cutoff', value: 4.2 });
        expect(audioEngine.updateDeviceParam).toHaveBeenCalledTimes(1);
        expect(audioEngine.updateDeviceParam).toHaveBeenCalledWith('t1', 'd1', 'cutoff', 1);
        expect(sendNativeDeviceParameters).not.toHaveBeenCalled();
    });

    // A hosted plugin's Web Audio path is IPC to the very instance the engine
    // stamps, so a write here would be the second writer this door exists to
    // avoid — not a fallback carrier that has to stay current.
    it('writes nothing at all for a hosted plugin', () => {
        projectHolding(
            createDevice({
                id: 'd1',
                name: 'Pro-Q',
                type: 'external-plugin',
                externalPluginId: 'clap:com.example.eq',
                externalInstanceId: 'inst-1',
            })
        );

        holdWebFallbackDeviceParam('t1', 'd1', 'gain', 0.75);

        expect(audioEngine.updateDeviceParam).not.toHaveBeenCalled();
        expect(sendNativeDeviceParameters).not.toHaveBeenCalled();
    });

    // A type the engine builds no body for is never carried, so its curve
    // belongs on the ordinary door rather than on this one.
    it('writes nothing for a built-in the engine builds no native body for', () => {
        projectHolding(createDevice({ id: 'd1', type: 'crust' }));

        holdWebFallbackDeviceParam('t1', 'd1', 'drive', 0.75);

        expect(audioEngine.updateDeviceParam).not.toHaveBeenCalled();
        expect(sendNativeDeviceParameters).not.toHaveBeenCalled();
    });

    // A device project truth does not hold on this strip is not carried by any
    // session either, so nothing here has a fallback to keep current.
    it('writes nothing for a device the project does not hold on this strip', () => {
        holdWebFallbackDeviceParam('t1', 'absent', 'cutoff', 0.75);

        expect(audioEngine.updateDeviceParam).not.toHaveBeenCalled();
        expect(sendNativeDeviceParameters).not.toHaveBeenCalled();
    });
});
