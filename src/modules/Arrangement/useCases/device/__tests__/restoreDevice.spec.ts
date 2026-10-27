import { beforeEach, describe, expect, it, vi } from 'vitest';

import { restoreDevice } from '../restoreDevice';

type TrackUpdater = (track: { devices: unknown[] }) => { devices: unknown[] };

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn(),
    resolveEligibleDeviceWriteTarget: vi.fn(),
    updateTrack: vi.fn<(trackId: string, updater: TrackUpdater) => void>(),
    projectTrackToLiveStrip: vi.fn(),
    applyDeviceChainRuntimeDelta: vi.fn(),
    updateDeviceBypass: vi.fn(),
    updateDeviceParam: vi.fn(),
    activateExternalPlugin: vi.fn(),
    reportLatency: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    updateDeviceBypass: mocks.updateDeviceBypass,
    updateDeviceParam: mocks.updateDeviceParam,
    reportLatency: mocks.reportLatency,
}));
vi.mock('#/modules/PluginHost/useCases', () => ({ activateExternalPlugin: mocks.activateExternalPlugin }));

vi.mock('../../../repositories/track/getTrackState', () => ({ getTrackState: mocks.getTrackState }));
vi.mock('../../../stores/resolveEligibleDeviceWriteTarget', () => ({
    resolveEligibleDeviceWriteTarget: mocks.resolveEligibleDeviceWriteTarget,
}));
vi.mock('../../../repositories/track/updateTrack', () => ({ updateTrack: mocks.updateTrack }));
vi.mock('../../projectTrackToLiveStrip', () => ({ projectTrackToLiveStrip: mocks.projectTrackToLiveStrip }));

vi.mock('../applyDeviceChainRuntimeDelta', () => ({
    applyDeviceChainRuntimeDelta: mocks.applyDeviceChainRuntimeDelta,
}));

describe('restoreDevice', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resolveEligibleDeviceWriteTarget.mockReturnValue({
            status: 'eligible',
            trackId: 'track-1',
            deviceId: 'restored',
        });
        mocks.applyDeviceChainRuntimeDelta.mockReturnValue({ acceptance: 'accepted', application: 'applied' });
        mocks.projectTrackToLiveStrip.mockReturnValue({ acceptance: 'accepted', application: 'applied' });
        mocks.updateTrack.mockImplementation((trackId, updater) => {
            const state = mocks.getTrackState();
            mocks.getTrackState.mockReturnValue({
                ...state,
                tracks: state.tracks.map((track: { id: string; devices: unknown[] }) =>
                    track.id === trackId ? { ...track, ...updater(track) } : track
                ),
            });
        });
    });

    it('restores the exact snapshot at its original chain index and applies its live delta and controls', () => {
        const track = {
            id: 'track-1',
            kind: 'audio',
            parentId: null,
            devices: [
                { id: 'before', type: 'builtin-gain' },
                { id: 'after', type: 'builtin-delay' },
            ],
        };
        mocks.getTrackState.mockReturnValue({ tracks: [track] });
        const snapshot = {
            id: 'restored',
            name: 'EQ',
            type: 'builtin-eq',
            bypassed: true,
            parameterValues: { frequency: 2400 },
        };

        const outcome = restoreDevice({ trackId: track.id, deviceSnapshot: snapshot, deviceIndex: 1 });
        const updater = mocks.updateTrack.mock.calls[0]?.[1];
        if (!updater) {
            throw new Error('Expected restoreDevice to update the owning track');
        }
        const updated = updater(track);

        expect(outcome).toBe('written');
        expect(updated.devices).toEqual([track.devices[0], snapshot, track.devices[1]]);
        expect(mocks.applyDeviceChainRuntimeDelta).toHaveBeenCalledWith(
            expect.objectContaining({ operation: 'add-device' })
        );
        expect(mocks.updateDeviceParam).toHaveBeenCalledWith(track.id, snapshot.id, 'frequency', 2400);
        expect(mocks.updateDeviceBypass).toHaveBeenCalledWith(track.id, snapshot.id, true);
    });

    it('rejects a stale inverse when the device identity already exists', () => {
        const snapshot = {
            id: 'restored',
            name: 'EQ',
            type: 'builtin-eq',
            bypassed: false,
            parameterValues: {},
        };
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 'track-1', kind: 'audio', parentId: null, devices: [snapshot] }],
        });

        expect(restoreDevice({ trackId: 'track-1', deviceSnapshot: snapshot, deviceIndex: 0 })).toBe('conflict');
        expect(mocks.updateTrack).not.toHaveBeenCalled();
    });

    it('defers live-strip projection until the project transaction commits', () => {
        const track = {
            id: 'track-1',
            kind: 'audio',
            parentId: null,
            devices: [{ id: 'before', type: 'builtin-gain' }],
        };
        const snapshot = {
            id: 'restored',
            name: 'Delay',
            type: 'builtin-delay',
            bypassed: false,
            parameterValues: { mix: 0.2 },
        };
        mocks.getTrackState.mockReturnValue({ tracks: [track] });

        const outcome = restoreDevice(
            { trackId: track.id, deviceSnapshot: snapshot, deviceIndex: 1 },
            { deferRuntimeEffects: true }
        );

        expect(outcome).not.toBe('conflict');
        expect(mocks.projectTrackToLiveStrip).not.toHaveBeenCalled();
        if (outcome === 'conflict') {
            throw new Error('Expected deferred restore result');
        }
        mocks.getTrackState.mockReturnValue({ tracks: [{ ...track, devices: [...track.devices, snapshot] }] });
        outcome.afterCommit();
        expect(mocks.applyDeviceChainRuntimeDelta).toHaveBeenCalledWith(
            expect.objectContaining({ operation: 'add-device' })
        );
        expect(mocks.updateDeviceParam).toHaveBeenCalledWith(track.id, snapshot.id, 'mix', 0.2);
    });

    it('replays controls, bypass and external activation from the final committed device', () => {
        const track = { id: 'track-1', kind: 'audio', parentId: null, devices: [] };
        const snapshot = {
            id: 'restored',
            name: 'Plugin',
            type: 'external-plugin',
            bypassed: false,
            parameterValues: { cutoff: 2400 },
            externalPluginId: 'original-plugin',
            externalInstanceId: 'original-instance',
            externalStateChunk: 'removed-state',
        };
        mocks.getTrackState.mockReturnValue({ tracks: [track] });
        const outcome = restoreDevice(
            { trackId: track.id, deviceSnapshot: snapshot, deviceIndex: 0 },
            { deferRuntimeEffects: true }
        );
        if (outcome === 'conflict') {
            throw new Error('Expected deferred restore result');
        }
        const committedDevice = {
            ...snapshot,
            bypassed: true,
            parameterValues: { cutoff: 1000 },
            externalPluginId: 'committed-plugin',
            externalInstanceId: 'committed-instance',
            externalStateChunk: 'committed-state',
        };
        mocks.getTrackState.mockReturnValue({ tracks: [{ ...track, devices: [committedDevice] }] });

        outcome.afterCommit();

        expect(mocks.updateDeviceParam).toHaveBeenCalledExactlyOnceWith(track.id, snapshot.id, 'cutoff', 1000);
        expect(mocks.updateDeviceBypass).toHaveBeenCalledExactlyOnceWith(track.id, snapshot.id, true);
        expect(mocks.activateExternalPlugin).toHaveBeenCalledExactlyOnceWith({
            pluginId: 'committed-plugin',
            instanceId: 'committed-instance',
            stateChunk: 'committed-state',
            onLatencyMs: expect.any(Function),
        });
        mocks.activateExternalPlugin.mock.calls[0]?.[0].onLatencyMs(4);
        expect(mocks.reportLatency).toHaveBeenCalledWith(snapshot.id, 4);
    });

    it.each([
        { status: 'missing' },
        { status: 'ineligible' },
        { status: 'eligible', trackId: 'other-owner', deviceId: 'restored' },
    ])('skips a restored device whose committed ownership is $status on $trackId', (target) => {
        const track = { id: 'track-1', kind: 'audio', parentId: null, devices: [] };
        const snapshot = {
            id: 'restored',
            name: 'Plugin',
            type: 'external-plugin',
            bypassed: false,
            parameterValues: { cutoff: 2400 },
            externalPluginId: 'plugin',
            externalInstanceId: 'instance',
        };
        mocks.getTrackState.mockReturnValue({ tracks: [track] });
        const outcome = restoreDevice(
            { trackId: track.id, deviceSnapshot: snapshot, deviceIndex: 0 },
            { deferRuntimeEffects: true }
        );
        if (outcome === 'conflict') {
            throw new Error('Expected deferred restore result');
        }
        mocks.resolveEligibleDeviceWriteTarget.mockReturnValue(target);

        outcome.afterCommit();

        expect(mocks.applyDeviceChainRuntimeDelta).not.toHaveBeenCalled();
        expect(mocks.activateExternalPlugin).not.toHaveBeenCalled();
        expect(mocks.updateDeviceParam).not.toHaveBeenCalled();
        expect(mocks.updateDeviceBypass).not.toHaveBeenCalled();
    });

    it('propagates a rejected committed restore without replaying controls or activating a plugin', () => {
        const track = { id: 'track-1', kind: 'audio', parentId: null, devices: [] };
        const snapshot = {
            id: 'restored',
            name: 'Plugin',
            type: 'external-plugin',
            bypassed: false,
            parameterValues: { cutoff: 2400 },
            externalPluginId: 'plugin',
            externalInstanceId: 'instance',
        };
        mocks.getTrackState.mockReturnValue({ tracks: [track] });
        const outcome = restoreDevice(
            { trackId: track.id, deviceSnapshot: snapshot, deviceIndex: 0 },
            { deferRuntimeEffects: true }
        );
        if (outcome === 'conflict') {
            throw new Error('Expected deferred restore result');
        }
        mocks.applyDeviceChainRuntimeDelta.mockReturnValue({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'injected restore rejection',
        });

        expect(outcome.afterCommit).toThrow('injected restore rejection');
        expect(outcome.afterAmbiguousCommit).toThrow('injected restore rejection');
        expect(mocks.applyDeviceChainRuntimeDelta).toHaveBeenCalledTimes(1);
        expect(mocks.activateExternalPlugin).not.toHaveBeenCalled();
        expect(mocks.updateDeviceParam).not.toHaveBeenCalled();
        expect(mocks.updateDeviceBypass).not.toHaveBeenCalled();
    });
});
