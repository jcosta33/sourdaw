import { describe, it, expect, vi, beforeEach } from 'vitest';

const engineMocks = vi.hoisted(() => {
    const context = { currentTime: 12.5, sampleRate: 48_000, state: 'running', destination: {} };
    const masterAnalyser = { fftSize: 2048 };
    const masterAnalyserLeft = { fftSize: 256 };
    const masterAnalyserRight = { fftSize: 256 };
    const trackAnalyser = { fftSize: 256 };
    const trackStrip = { trackId: 't1', analyserNode: trackAnalyser };
    const toasterControls = { ready: true, noteOn: vi.fn() };
    const engineState = { tracks: [], buses: [] };
    const engineContext: unknown = context;
    return {
        context,
        masterAnalyser,
        masterAnalyserLeft,
        masterAnalyserRight,
        trackAnalyser,
        trackStrip,
        toasterControls,
        engineState,
        engine: {
            context: engineContext,
            masterAnalyser,
            masterAnalyserLeft,
            masterAnalyserRight,
            getState: vi.fn(() => engineState),
            getMasterPeakLevel: vi.fn(() => 0.42),
            getTrackStrip: vi.fn(),
            findToasterControls: vi.fn(),
            setMasterGain: vi.fn(),
            setSend: vi.fn(),
            scheduleSendAutomation: vi.fn(),
            removeSend: vi.fn(),
            removeTrackStrip: vi.fn(),
            removeBusStrip: vi.fn(),
            wireSidechainRoute: vi.fn(),
            unwireSidechainRoute: vi.fn(),
            refreshSidechainAlignment: vi.fn(),
            resume: vi.fn(() => Promise.resolve()),
            waitForDevices: vi.fn(() => Promise.resolve()),
        },
    };
});

vi.mock('../../repositories/createWebAudioEngine', () => ({
    audioEngine: engineMocks.engine,
    ensureEngine: vi.fn(),
}));

import { getAudioContext } from '../engineAccess/getAudioContext';
import { getAudioSampleRate } from '../engineAccess/getAudioSampleRate';
import { getAudioTime } from '../engineAccess/getAudioTime';
import { getEngineState } from '../engineAccess/getEngineState';
import { getMasterAnalyser } from '../engineAccess/getMasterAnalyser';
import { getMasterPeakLevel } from '../engineAccess/getMasterPeakLevel';
import { getMasterStereoAnalysers } from '../engineAccess/getMasterStereoAnalysers';
import { getToasterDeviceControls } from '../engineAccess/getToasterDeviceControls';
import { getTrackAnalyser } from '../engineAccess/getTrackAnalyser';
import { getTrackStrip } from '../engineAccess/getTrackStrip';
import { removeBusStrip } from '../engineAccess/removeBusStrip';
import { removeSend } from '../engineAccess/removeSend';
import { removeTrackStrip } from '../engineAccess/removeTrackStrip';
import { resumeEngine } from '../engineAccess/resumeEngine';
import { scheduleSendAutomation } from '../engineAccess/scheduleSendAutomation';
import { setMasterGainValue } from '../engineAccess/setMasterGainValue';
import { setSend } from '../engineAccess/setSend';
import { unwireSidechainRoute } from '../engineAccess/unwireSidechainRoute';
import { waitForDevices } from '../engineAccess/waitForDevices';
import { wireSidechainRoute } from '../engineAccess/wireSidechainRoute';

describe('engineAccess', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        engineMocks.engine.context = engineMocks.context;
        engineMocks.engine.getState.mockReturnValue(engineMocks.engineState);
        engineMocks.engine.getMasterPeakLevel.mockReturnValue(0.42);
        engineMocks.engine.resume.mockResolvedValue(undefined);
        engineMocks.engine.waitForDevices.mockResolvedValue(undefined);
    });

    it('getAudioContext returns the engine-owned context instance', () => {
        expect(getAudioContext()).toBe(engineMocks.context);
    });

    it('getAudioTime reads the context clock and falls back to 0 without a context', () => {
        expect(getAudioTime()).toBe(12.5);

        engineMocks.engine.context = undefined;
        expect(getAudioTime()).toBe(0);
    });

    it('getAudioSampleRate reads the context rate and falls back to 44100 without a context', () => {
        expect(getAudioSampleRate()).toBe(48_000);

        engineMocks.engine.context = undefined;
        expect(getAudioSampleRate()).toBe(44_100);
    });

    it('getEngineState returns the engine state snapshot', () => {
        expect(getEngineState()).toBe(engineMocks.engineState);
        expect(engineMocks.engine.getState).toHaveBeenCalledTimes(1);
    });

    it('getMasterAnalyser exposes the engine master analyser node', () => {
        expect(getMasterAnalyser()).toBe(engineMocks.masterAnalyser);
    });

    it('getMasterStereoAnalysers exposes the engine left/right stereo tap nodes', () => {
        const stereo = getMasterStereoAnalysers();
        expect(stereo.left).toBe(engineMocks.masterAnalyserLeft);
        expect(stereo.right).toBe(engineMocks.masterAnalyserRight);
    });

    it('getMasterPeakLevel returns the live master peak value', () => {
        expect(getMasterPeakLevel()).toBe(0.42);
    });

    it('getTrackStrip resolves a strip by track id', () => {
        engineMocks.engine.getTrackStrip.mockReturnValue(engineMocks.trackStrip);

        expect(getTrackStrip('t1')).toBe(engineMocks.trackStrip);
        expect(engineMocks.engine.getTrackStrip).toHaveBeenCalledWith('t1');
    });

    it('getTrackAnalyser returns the strip analyser, or null when the strip is missing', () => {
        engineMocks.engine.getTrackStrip.mockReturnValue(engineMocks.trackStrip);
        expect(getTrackAnalyser('t1')).toBe(engineMocks.trackAnalyser);

        engineMocks.engine.getTrackStrip.mockReturnValue(undefined);
        expect(getTrackAnalyser('ghost')).toBeNull();
    });

    it('getToasterDeviceControls resolves loaded toaster controls and undefined otherwise', () => {
        engineMocks.engine.findToasterControls.mockReturnValue(engineMocks.toasterControls);
        expect(getToasterDeviceControls('toast-1')).toBe(engineMocks.toasterControls);
        expect(engineMocks.engine.findToasterControls).toHaveBeenCalledWith('toast-1');

        engineMocks.engine.findToasterControls.mockReturnValue(undefined);
        expect(getToasterDeviceControls('ghost')).toBeUndefined();
    });

    it('setMasterGainValue delegates the gain value to the engine', () => {
        setMasterGainValue(0.65);
        expect(engineMocks.engine.setMasterGain).toHaveBeenCalledWith(0.65);
    });

    it('setSend and removeSend pass source, bus, level, and tap position through', () => {
        setSend('t1', 'bus-1', 0.3, true);
        expect(engineMocks.engine.setSend).toHaveBeenCalledWith('t1', 'bus-1', 0.3, true);

        removeSend('t1', 'bus-1');
        expect(engineMocks.engine.removeSend).toHaveBeenCalledWith('t1', 'bus-1');
    });

    it('scheduleSendAutomation passes the exact absolute landing time through', () => {
        scheduleSendAutomation('t1', 'bus-1', 0.3, 12.55);
        expect(engineMocks.engine.scheduleSendAutomation).toHaveBeenCalledWith('t1', 'bus-1', 0.3, 12.55);
    });

    it('wire/unwireSidechainRoute pass their route endpoints through', () => {
        wireSidechainRoute('src-track', 'dst-track', 'comp-1');
        expect(engineMocks.engine.wireSidechainRoute).toHaveBeenCalledWith('src-track', 'dst-track', 'comp-1');

        unwireSidechainRoute('src-track', 'comp-1');
        expect(engineMocks.engine.unwireSidechainRoute).toHaveBeenCalledWith('src-track', 'comp-1');
    });

    it('removeTrackStrip and removeBusStrip tear down strips by id', () => {
        removeTrackStrip('t1');
        expect(engineMocks.engine.removeTrackStrip).toHaveBeenCalledWith('t1');

        removeBusStrip('bus-1');
        expect(engineMocks.engine.removeBusStrip).toHaveBeenCalledWith('bus-1');
    });

    it('resumeEngine and waitForDevices return the engine promises', async () => {
        await expect(resumeEngine()).resolves.toBeUndefined();
        expect(engineMocks.engine.resume).toHaveBeenCalledTimes(1);

        await expect(waitForDevices()).resolves.toBeUndefined();
        expect(engineMocks.engine.waitForDevices).toHaveBeenCalledTimes(1);
    });
});
