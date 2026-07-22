import { beforeEach, describe, expect, it, vi } from 'vitest';

import { trackStore } from '../../stores/trackStore';
import { createTrack } from '../createTrack';
import { projectTrackToLiveStrip } from '../projectTrackToLiveStrip';

const mocks = vi.hoisted(() => ({
    ensureTrackStrip: vi.fn(),
    setTrackOutput: vi.fn(),
    setTrackGain: vi.fn(),
    setTrackPan: vi.fn(),
    setTrackMute: vi.fn(),
    addDeviceToStrip: vi.fn(),
    updateDeviceParam: vi.fn(),
    updateDeviceBypass: vi.fn(),
    setSend: vi.fn(),
    wireSidechainRoutes: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    ensureTrackStrip: mocks.ensureTrackStrip,
    setTrackOutput: mocks.setTrackOutput,
    setTrackGain: mocks.setTrackGain,
    setTrackPan: mocks.setTrackPan,
    setTrackMute: mocks.setTrackMute,
    addDeviceToStrip: mocks.addDeviceToStrip,
    updateDeviceParam: mocks.updateDeviceParam,
    updateDeviceBypass: mocks.updateDeviceBypass,
}));

vi.mock('#/modules/Routing/useCases', () => ({
    setSend: mocks.setSend,
    wireSidechainRoutes: mocks.wireSidechainRoutes,
}));

describe('projectTrackToLiveStrip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        trackStore.set({ tracks: [], selectedTrackId: null });
    });

    it('projects the current owned track in device-chain order and wires sidechains last', () => {
        const track = createTrack({ id: 'audio-1', name: 'Audio', kind: 'audio' });
        track.gain = 0.75;
        track.pan = -0.25;
        track.outputId = 'master';
        track.sends = [{ busId: 'bus-1', level: 0.4, preFader: true }];
        track.devices = [
            {
                id: 'device-1',
                name: 'Native effect',
                type: 'external-plugin',
                bypassed: true,
                parameterValues: { feedback: 0.6, mix: 0.3 },
                externalPluginId: 'persisted-native-plugin',
                externalInstanceId: 'persisted-native-instance',
            },
        ];
        const master = createTrack({ id: 'master', name: 'Master', kind: 'master' });
        const bus = createTrack({ id: 'bus-1', name: 'Bus', kind: 'bus' });
        trackStore.set({ tracks: [track, master, bus], selectedTrackId: null });

        projectTrackToLiveStrip({ trackId: track.id });

        expect(mocks.ensureTrackStrip).toHaveBeenCalledWith('audio-1');
        expect(mocks.setTrackOutput).toHaveBeenCalledWith('audio-1', 'master');
        expect(mocks.setTrackGain).toHaveBeenCalledWith('audio-1', 0.75);
        expect(mocks.setTrackPan).toHaveBeenCalledWith('audio-1', -0.25);
        expect(mocks.setTrackMute).toHaveBeenCalledWith('audio-1', false);
        expect(mocks.addDeviceToStrip.mock.calls[0]).toEqual(['audio-1', 'device-1', 'external-plugin']);
        expect(mocks.updateDeviceParam).toHaveBeenNthCalledWith(1, 'audio-1', 'device-1', 'feedback', 0.6);
        expect(mocks.updateDeviceParam).toHaveBeenNthCalledWith(2, 'audio-1', 'device-1', 'mix', 0.3);
        expect(mocks.updateDeviceBypass).toHaveBeenCalledWith('audio-1', 'device-1', true);
        expect(mocks.setSend).toHaveBeenCalledWith('audio-1', 'bus-1', 0.4, true);
        expect(mocks.wireSidechainRoutes.mock.invocationCallOrder[0] ?? 0).toBeGreaterThan(
            mocks.updateDeviceBypass.mock.invocationCallOrder[0] ?? 0
        );
    });

    it('uses effective solo mute and can defer global sidechain wiring', () => {
        const target = createTrack({ id: 'target', name: 'Target', kind: 'audio' });
        const soloed = createTrack({ id: 'soloed', name: 'Soloed', kind: 'audio' });
        soloed.soloed = true;
        trackStore.set({ tracks: [target, soloed], selectedTrackId: null });

        projectTrackToLiveStrip({ trackId: target.id, deferSidechainWiring: true });

        expect(mocks.setTrackMute).toHaveBeenCalledWith('target', true);
        expect(mocks.wireSidechainRoutes).not.toHaveBeenCalled();
    });

    it('refuses ambiguous track ownership', () => {
        const first = createTrack({ id: 'duplicate', name: 'First', kind: 'audio' });
        const second = createTrack({ id: 'duplicate', name: 'Second', kind: 'audio' });
        first.devices = [{ id: 'shared', name: 'First', type: 'delay', bypassed: false, parameterValues: {} }];
        second.devices = [{ id: 'shared', name: 'Second', type: 'delay', bypassed: false, parameterValues: {} }];
        trackStore.set({ tracks: [first, second], selectedTrackId: null });

        projectTrackToLiveStrip({ trackId: 'duplicate' });

        expect(mocks.ensureTrackStrip).not.toHaveBeenCalled();
        expect(mocks.addDeviceToStrip).not.toHaveBeenCalled();
        expect(mocks.wireSidechainRoutes).not.toHaveBeenCalled();
    });

    it('does not project a device with ambiguous ownership', () => {
        const owner = createTrack({ id: 'owner', name: 'Owner', kind: 'audio' });
        const other = createTrack({ id: 'other', name: 'Other', kind: 'audio' });
        owner.devices = [{ id: 'shared', name: 'First', type: 'delay', bypassed: false, parameterValues: {} }];
        other.devices = [{ id: 'shared', name: 'Second', type: 'delay', bypassed: false, parameterValues: {} }];
        trackStore.set({ tracks: [owner, other], selectedTrackId: null });

        projectTrackToLiveStrip({ trackId: owner.id });

        expect(mocks.ensureTrackStrip).toHaveBeenCalledWith(owner.id);
        expect(mocks.addDeviceToStrip).not.toHaveBeenCalled();
    });

    it('projects a Toaster folder but leaves an ordinary folder dormant', () => {
        const dormant = createTrack({ id: 'folder', name: 'Folder', kind: 'folder' });
        const toaster = createTrack({ id: 'toaster', name: 'Toaster', kind: 'folder' });
        toaster.devices = [
            { id: 'toaster-device', name: 'Toaster', type: 'toaster', bypassed: false, parameterValues: {} },
        ];
        trackStore.set({ tracks: [dormant, toaster], selectedTrackId: null });

        projectTrackToLiveStrip({ trackId: dormant.id });
        projectTrackToLiveStrip({ trackId: toaster.id });

        expect(mocks.ensureTrackStrip).toHaveBeenCalledOnce();
        expect(mocks.ensureTrackStrip).toHaveBeenCalledWith(toaster.id);
        expect(mocks.addDeviceToStrip).toHaveBeenCalledWith(toaster.id, 'toaster-device', 'toaster');
    });

    it('skips resolved routing targets that cannot own audio endpoints', () => {
        const track = createTrack({ id: 'audio-1', name: 'Audio', kind: 'audio' });
        const vca = createTrack({ id: 'vca-1', name: 'VCA', kind: 'audio' });
        Object.defineProperty(vca, 'kind', { value: 'vca' });
        track.outputId = vca.id;
        track.sends = [{ busId: vca.id, level: 0.5, preFader: false }];
        trackStore.set({ tracks: [track, vca], selectedTrackId: null });

        projectTrackToLiveStrip({ trackId: track.id });

        expect(mocks.setTrackOutput).not.toHaveBeenCalled();
        expect(mocks.setSend).not.toHaveBeenCalled();
    });
});
