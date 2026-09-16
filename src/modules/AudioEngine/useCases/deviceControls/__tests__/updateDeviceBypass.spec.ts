import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { trackStore, type Device, type Track } from '#/modules/Arrangement/stores';

import { audioEngine } from '../../../repositories/createWebAudioEngine';
import { isDeviceCarriedByNativeSession } from '../../livePlayback/isDeviceCarriedByNativeSession';
import { sendNativeDeviceBypass } from '../../livePlayback/sendNativeDeviceBypass';
import { updateDeviceBypass } from '../updateDeviceBypass';

vi.mock('../../../repositories/createWebAudioEngine', () => ({
    audioEngine: {
        updateDeviceBypass: vi.fn(),
    },
}));

vi.mock('../../livePlayback/isDeviceCarriedByNativeSession', () => ({
    isDeviceCarriedByNativeSession: vi.fn(() => false),
}));

vi.mock('../../livePlayback/sendNativeDeviceBypass', () => ({
    sendNativeDeviceBypass: vi.fn(async () => true),
}));

function createDevice(overrides: Partial<Device> & { id: string }): Device {
    return { name: overrides.id, type: 'knead', bypassed: false, parameterValues: {}, ...overrides };
}

/** Puts one device on one track, which is where the write path reads its body from. */
function projectHolding(device: Device): void {
    trackStore.set({
        tracks: [{ id: 't1', name: 'Lead', devices: [device] } as unknown as Track],
        selectedTrackId: null,
        ghostClips: [],
    });
}

describe('updateDeviceBypass', () => {
    beforeEach(() => {
        vi.mocked(audioEngine.updateDeviceBypass).mockClear();
        vi.mocked(sendNativeDeviceBypass).mockClear();
        vi.mocked(isDeviceCarriedByNativeSession).mockReset();
        vi.mocked(isDeviceCarriedByNativeSession).mockReturnValue(false);
        projectHolding(createDevice({ id: 'd1', type: 'knead' }));
    });

    afterEach(() => {
        trackStore.set(null);
    });

    it('should forward to the audio engine', () => {
        updateDeviceBypass('t1', 'd1', true);

        expect(audioEngine.updateDeviceBypass).toHaveBeenCalledWith('t1', 'd1', true);
    });

    // A carried strip's Web Audio node is gated out of the mix while rolling,
    // so a toggle that moved only that node would move a control nobody was
    // hearing and the engine would learn the bypass at the next Play. The
    // native send is additive: the Web Audio node still gets the write, for the
    // moment Stop reopens the gate and it is the fallback carrier again.
    it('writes the Web Audio node and forwards to the carried native body', () => {
        vi.mocked(isDeviceCarriedByNativeSession).mockReturnValue(true);

        updateDeviceBypass('t1', 'd1', true);

        expect(audioEngine.updateDeviceBypass).toHaveBeenCalledTimes(1);
        expect(audioEngine.updateDeviceBypass).toHaveBeenCalledWith('t1', 'd1', true);
        expect(sendNativeDeviceBypass).toHaveBeenCalledTimes(1);
        expect(sendNativeDeviceBypass).toHaveBeenCalledWith({ trackId: 't1', deviceId: 'd1', bypassed: true });
    });

    it('forwards a release with its direction, not just an engage', () => {
        vi.mocked(isDeviceCarriedByNativeSession).mockReturnValue(true);

        updateDeviceBypass('t1', 'd1', false);

        expect(audioEngine.updateDeviceBypass).toHaveBeenCalledWith('t1', 'd1', false);
        expect(sendNativeDeviceBypass).toHaveBeenCalledWith({ trackId: 't1', deviceId: 'd1', bypassed: false });
    });

    // A device the session is not carrying is still Web Audio's to sound, and
    // a native send would address a device the engine does not hold.
    it('does not forward for a built-in no native session is carrying', () => {
        updateDeviceBypass('t1', 'd1', true);

        expect(audioEngine.updateDeviceBypass).toHaveBeenCalledWith('t1', 'd1', true);
        expect(sendNativeDeviceBypass).not.toHaveBeenCalled();
    });

    // A hosted plugin's bypass is the instance's own, written by its device
    // node over the plugin host's ordered control path; `set-device-bypass`
    // names a built-in only, and the engine refuses one aimed at a plugin.
    it('does not forward for a carried device the engine builds no built-in body for', () => {
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

        updateDeviceBypass('t1', 'd1', true);

        expect(audioEngine.updateDeviceBypass).toHaveBeenCalledWith('t1', 'd1', true);
        expect(sendNativeDeviceBypass).not.toHaveBeenCalled();
    });
});
