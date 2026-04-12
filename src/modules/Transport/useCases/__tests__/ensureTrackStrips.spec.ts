import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ensureTrackStrips } from '../ensureTrackStrips';

const mocks = vi.hoisted(() => ({
    trackStoreValue: { value: null },
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
}));

// Mock the store file directly
vi.mock('#/modules/Arrangement/stores/trackStore', () => ({
    trackStore: { get value() { return mocks.trackStoreValue.value; } }
}));

// Mock the barrel re-exports but satisfy the markerStore etc. if needed by other components
vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: { get value() { return mocks.trackStoreValue.value; } },
    markerStore: { value: { markers: [], sections: [] } },
    chordTrackStore: { value: {} },
    scratchPadStore: { value: {} },
    takeLaneStore: { value: {} },
}));

// Mock AudioEngine use cases
vi.mock('#/modules/AudioEngine/useCases', async () => ({
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
vi.mock('#/modules/Routing/useCases', async () => ({
    ensureBusStrip: mocks.ensureBusStrip,
    setBusGain: mocks.setBusGain,
    setSend: mocks.setSend,
}));

describe('ensureTrackStrips', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('bootstraps tracks and their components in the engine', () => {
        mocks.trackStoreValue.value = {
            tracks: [
                {
                    id: 't1',
                    kind: 'audio',
                    gain: 0.8,
                    pan: -10,
                    muted: false,
                    soloed: false,
                    outputId: 'main',
                    devices: [
                        { id: 'd1', type: 'reverb', parameterValues: { room: 0.5 } }
                    ],
                    sends: [{ busId: 'b1', level: 0.1, preFader: false }],
                },
                { id: 'b1', kind: 'bus', gain: 1.0 },
            ]
        } as any;

        ensureTrackStrips();

        expect(mocks.ensureBusStrip).toHaveBeenCalledWith('b1');
        expect(mocks.ensureTrackStrip).toHaveBeenCalledWith('t1');
        expect(mocks.setTrackGain).toHaveBeenCalledWith('t1', 0.8);
        expect(mocks.setSend).toHaveBeenCalledWith('t1', 'b1', 0.1, false);
    });
});
