/**
 * Where a whole patch lands, and that it lands whole (#3893).
 *
 * A patch load is one gesture. The Web Audio node always gets it, carried or
 * not: gated out of the mix while the native session carries the strip, that
 * node is still the fallback carrier for the moment Stop reopens the gate, and
 * it has to already hold the current patch then. A carried built-in gets the
 * same patch additionally, over the graph command path. What is under test is
 * that the web write always lands, that the native send lands only when
 * carried, and that nothing of the patch is lost on the way.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { trackStore, type Device, type Track } from '#/modules/Arrangement/stores';

import { audioEngine } from '../../../repositories/createWebAudioEngine';
import { isDeviceCarriedByNativeSession } from '../../livePlayback/isDeviceCarriedByNativeSession';
import { sendNativeDeviceParameters } from '../../livePlayback/sendNativeDeviceParameters';
import { updateDevicePatch } from '../updateDevicePatch';

vi.mock('../../../repositories/createWebAudioEngine', () => ({
    audioEngine: {
        updateDevicePatch: vi.fn(),
    },
}));

vi.mock('../../livePlayback/isDeviceCarriedByNativeSession', () => ({
    isDeviceCarriedByNativeSession: vi.fn(() => false),
}));

vi.mock('../../livePlayback/sendNativeDeviceParameters', () => ({
    sendNativeDeviceParameters: vi.fn(async () => true),
}));

function createDevice(overrides: Partial<Device> & { id: string }): Device {
    return { name: overrides.id, type: 'fermenter', bypassed: false, parameterValues: {}, ...overrides };
}

/** Puts one device on one track, which is where the write path reads its body from. */
function projectHolding(device: Device): void {
    trackStore.set({
        tracks: [{ id: 't1', name: 'Lead', devices: [device] } as unknown as Track],
        selectedTrackId: null,
        ghostClips: [],
    });
}

/**
 * A patch already spelled the way the engine spells one, larger than a single
 * record's ceiling — which is what the Fermenter patch bridge sends, and what
 * proves the projection does not quietly drop or rename a snake_case key.
 */
function enginePatchOf(count: number): Record<string, number> {
    return Object.fromEntries(Array.from({ length: count }, (_value, index) => [`param_${index}`, index / 100]));
}

describe('updateDevicePatch', () => {
    beforeEach(() => {
        vi.mocked(audioEngine.updateDevicePatch).mockClear();
        vi.mocked(sendNativeDeviceParameters).mockClear();
        vi.mocked(isDeviceCarriedByNativeSession).mockReset();
        vi.mocked(isDeviceCarriedByNativeSession).mockReturnValue(false);
        projectHolding(createDevice({ id: 'd1' }));
    });

    afterEach(() => {
        trackStore.set(null);
    });

    it('writes the Web Audio node and hands the carried native body the whole patch in one write', () => {
        vi.mocked(isDeviceCarriedByNativeSession).mockReturnValue(true);
        const patch = enginePatchOf(130);

        updateDevicePatch('t1', 'd1', patch);

        expect(audioEngine.updateDevicePatch).toHaveBeenCalledTimes(1);
        expect(audioEngine.updateDevicePatch).toHaveBeenCalledWith('t1', 'd1', patch);
        expect(sendNativeDeviceParameters).toHaveBeenCalledTimes(1);
        expect(sendNativeDeviceParameters).toHaveBeenCalledWith({ trackId: 't1', deviceId: 'd1', values: patch });
    });

    // The panel's own ids are what project truth stores, so a patch authored
    // there has to reach the engine respelled rather than refused by name; the
    // Web Audio node keeps the patch in the caller's own spelling.
    it('writes the Web Audio node as authored and spells the carried native body in the names the instrument answers to', () => {
        vi.mocked(isDeviceCarriedByNativeSession).mockReturnValue(true);
        const patch = { oscEngine: 2, filterCutoff: 800 };

        updateDevicePatch('t1', 'd1', patch);

        expect(audioEngine.updateDevicePatch).toHaveBeenCalledWith('t1', 'd1', patch);
        expect(sendNativeDeviceParameters).toHaveBeenCalledWith({
            trackId: 't1',
            deviceId: 'd1',
            values: { engine: 2, cutoff: 800 },
        });
    });

    it('keeps the web write for a device no native session is carrying', () => {
        const patch = { oscEngine: 2 };

        updateDevicePatch('t1', 'd1', patch);

        expect(audioEngine.updateDevicePatch).toHaveBeenCalledWith('t1', 'd1', patch);
        expect(sendNativeDeviceParameters).not.toHaveBeenCalled();
    });

    it('keeps the web write for a carried device the engine builds no built-in body for', () => {
        projectHolding(
            createDevice({
                id: 'd1',
                name: 'Pro-Q',
                type: 'external-plugin',
                externalPluginId: 'clap:com.example.eq',
                externalInstanceId: 'inst-1',
            })
        );
        vi.mocked(isDeviceCarriedByNativeSession).mockReturnValue(true);
        const patch = { threshold: 0.5 };

        updateDevicePatch('t1', 'd1', patch);

        expect(audioEngine.updateDevicePatch).toHaveBeenCalledWith('t1', 'd1', patch);
        expect(sendNativeDeviceParameters).not.toHaveBeenCalled();
    });
});
