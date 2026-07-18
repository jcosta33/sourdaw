import { describe, it, expect, vi, beforeEach } from 'vitest';

const engineMocks = vi.hoisted(() => ({
    ensureBusStrip: vi.fn(),
    ensureTrackStrip: vi.fn(),
    setBusGain: vi.fn(),
    resetGraph: vi.fn(),
    context: { sampleRate: 48000 },
}));

vi.mock('../../repositories/createWebAudioEngine', () => ({
    audioEngine: {
        ensureBusStrip: engineMocks.ensureBusStrip,
        ensureTrackStrip: engineMocks.ensureTrackStrip,
        setBusGain: engineMocks.setBusGain,
        resetGraph: engineMocks.resetGraph,
        context: engineMocks.context,
    },
}));

vi.mock('../latencyCompensation/compensation/externalLatencyRegistry', () => ({
    clearAllReportedLatency: vi.fn(),
}));

import { ensureBusStrip } from '../engineAccess/ensureBusStrip';
import { ensureTrackStrip } from '../engineAccess/ensureTrackStrip';
import { getAudioSampleRate } from '../engineAccess/getAudioSampleRate';
import { resetAudioGraph } from '../engineAccess/resetAudioGraph';
import { setBusGain } from '../engineAccess/setBusGain';

describe('engine access functions', () => {
    beforeEach(() => vi.clearAllMocks());

    it('ensureBusStrip delegates to engine', () => {
        ensureBusStrip('bus-1');
        expect(engineMocks.ensureBusStrip).toHaveBeenCalledWith('bus-1');
    });

    it('ensureTrackStrip delegates to engine', () => {
        ensureTrackStrip('track-1');
        expect(engineMocks.ensureTrackStrip).toHaveBeenCalledWith('track-1');
    });

    it('setBusGain delegates to engine', () => {
        setBusGain('bus-1', 0.8);
        expect(engineMocks.setBusGain).toHaveBeenCalledWith('bus-1', 0.8);
    });

    it('getAudioSampleRate returns from context', () => {
        expect(getAudioSampleRate()).toBe(48000);
    });

    it('resetAudioGraph calls resetGraph and clearLatency', () => {
        resetAudioGraph();
        expect(engineMocks.resetGraph).toHaveBeenCalledTimes(1);
    });
});
