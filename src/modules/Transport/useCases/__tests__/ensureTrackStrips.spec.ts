import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createTrack } from '#/modules/Arrangement/useCases';

import { ensureTrackStrips } from '../ensureTrackStrips';

import type { TrackStoreState } from '#/modules/Arrangement/stores';

const mocks = vi.hoisted(() => ({
    trackStoreValue: { value: null as TrackStoreState | null },
    ensureTrackStrip: vi.fn(),
    setTrackOutput: vi.fn(),
    setTrackGain: vi.fn(),
    setTrackPan: vi.fn(),
    setTrackMute: vi.fn(),
    addDeviceToStrip: vi.fn(),
    updateDeviceParam: vi.fn(),
    ensureBusStrip: vi.fn(),
    setBusGain: vi.fn(),
    setSend: vi.fn(),
    wireSidechainRoutes: vi.fn(),
}));

// Mock the barrel re-exports but satisfy the markerStore etc. if needed by other components
vi.mock('#/modules/Arrangement/stores', () => ({
    getTrackEligibility: (kind: string) => ({
        acceptsRoutingEndpoint: ['audio', 'midi', 'bus', 'master', 'folder'].includes(kind),
        createsLiveStrip: kind !== 'folder' && kind !== 'vca' && kind !== undefined,
    }),
    trackStore: {
        get value() {
            return mocks.trackStoreValue.value;
        },
    },
    markerStore: { value: { markers: [], sections: [] } },
    chordTrackStore: { value: {} },
    scratchPadStore: { value: {} },
    takeLaneStore: { value: {} },
}));

// Mock AudioEngine use cases
vi.mock('#/modules/AudioEngine/useCases', () => ({
    ensureTrackStrip: mocks.ensureTrackStrip,
    setTrackOutput: mocks.setTrackOutput,
    setTrackGain: mocks.setTrackGain,
    setTrackPan: mocks.setTrackPan,
    setTrackMute: mocks.setTrackMute,
    addDeviceToStrip: mocks.addDeviceToStrip,
    updateDeviceParam: mocks.updateDeviceParam,
    // Add other common exports to satisfy the barrel mock
    resumeEngine: vi.fn(),
    getAudioContext: vi.fn(),
    stopAllScheduled: vi.fn(),
    resetMidiState: vi.fn(),
    scheduleClick: vi.fn(),
    startAudioRecording: vi.fn(),
    stopAudioRecording: vi.fn(),
}));

// Mock Routing use cases
vi.mock('#/modules/Routing/useCases', () => ({
    ensureBusStrip: mocks.ensureBusStrip,
    setBusGain: mocks.setBusGain,
    setSend: mocks.setSend,
    wireSidechainRoutes: mocks.wireSidechainRoutes,
}));

describe('ensureTrackStrips', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('bootstraps tracks and their components in the engine', () => {
        mocks.trackStoreValue.value = {
            selectedTrackId: null,
            tracks: [
                {
                    ...createTrack({ id: 't1', name: 't1', kind: 'audio' }),
                    gain: 0.8,
                    pan: -10,
                    muted: false,
                    soloed: false,
                    outputId: 'main',
                    devices: [
                        { id: 'd1', name: 'reverb', type: 'reverb', bypassed: false, parameterValues: { room: 0.5 } },
                    ],
                    sends: [{ busId: 'b1', level: 0.1, preFader: false }],
                },
                {
                    ...createTrack({ id: 'b1', name: 'b1', kind: 'bus' }),
                    gain: 1.0,
                    pan: 0,
                    muted: false,
                    soloed: false,
                    outputId: 'main',
                    devices: [],
                    sends: [],
                },
            ],
        };

        ensureTrackStrips();

        expect(mocks.ensureBusStrip).toHaveBeenCalledWith('b1');
        expect(mocks.ensureTrackStrip).toHaveBeenCalledWith('t1');
        expect(mocks.setTrackOutput).toHaveBeenCalledWith('t1', 'main');
        expect(mocks.setTrackGain).toHaveBeenCalledWith('t1', 0.8);
        expect(mocks.setSend).toHaveBeenCalledWith('t1', 'b1', 0.1, false);
    });

    it('wires persisted sidechain routes into the engine after strips exist', () => {
        mocks.trackStoreValue.value = {
            selectedTrackId: null,
            tracks: [
                {
                    ...createTrack({ id: 't1', name: 't1', kind: 'audio' }),
                    devices: [],
                    sends: [],
                },
            ],
        };

        ensureTrackStrips();

        expect(mocks.wireSidechainRoutes).toHaveBeenCalledTimes(1);
    });

    it('does not allocate or replay a strip for a dormant VCA', () => {
        const dormantVca = createTrack({ id: 'vca-1', name: 'VCA', kind: 'audio' });
        Object.defineProperty(dormantVca, 'kind', { value: 'vca' });
        dormantVca.devices = [{ id: 'd1', name: 'Device', type: 'device', bypassed: false, parameterValues: {} }];
        dormantVca.sends = [{ busId: 'b1', level: 0.5, preFader: false }];
        mocks.trackStoreValue.value = { selectedTrackId: null, tracks: [dormantVca] };

        ensureTrackStrips();

        expect(mocks.ensureTrackStrip).not.toHaveBeenCalled();
        expect(mocks.addDeviceToStrip).not.toHaveBeenCalled();
        expect(mocks.setSend).not.toHaveBeenCalled();
        expect(mocks.setTrackGain).not.toHaveBeenCalled();
        expect(mocks.setTrackMute).not.toHaveBeenCalled();
    });

    it('does not replay persisted output or sends toward a resolved dormant VCA', () => {
        const dormantVca = createTrack({ id: 'vca-1', name: 'VCA', kind: 'audio' });
        Object.defineProperty(dormantVca, 'kind', { value: 'vca' });
        mocks.trackStoreValue.value = {
            selectedTrackId: null,
            tracks: [
                {
                    ...createTrack({ id: 'audio-1', name: 'Audio', kind: 'audio' }),
                    outputId: 'vca-1',
                    sends: [{ busId: 'vca-1', level: 0.5, preFader: false }],
                },
                dormantVca,
            ],
        };

        ensureTrackStrips();

        expect(mocks.ensureTrackStrip).toHaveBeenCalledWith('audio-1');
        expect(mocks.setTrackOutput).not.toHaveBeenCalled();
        expect(mocks.setSend).not.toHaveBeenCalled();
    });

    it('does not replay persisted output or sends toward a resolved malformed track', () => {
        const malformedTarget = createTrack({ id: 'malformed-1', name: 'Malformed', kind: 'audio' });
        Object.defineProperty(malformedTarget, 'kind', { value: undefined });
        mocks.trackStoreValue.value = {
            selectedTrackId: null,
            tracks: [
                {
                    ...createTrack({ id: 'audio-1', name: 'Audio', kind: 'audio' }),
                    outputId: 'malformed-1',
                    sends: [{ busId: 'malformed-1', level: 0.5, preFader: false }],
                },
                malformedTarget,
            ],
        };

        ensureTrackStrips();

        expect(mocks.ensureTrackStrip).toHaveBeenCalledWith('audio-1');
        expect(mocks.setTrackOutput).not.toHaveBeenCalled();
        expect(mocks.setSend).not.toHaveBeenCalled();
    });
});
