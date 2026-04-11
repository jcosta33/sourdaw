import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { ensureTrackStrips } from './ensureTrackStrips';

describe('ensureTrackStrips', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('noops when no tracks are loaded', () => {
        const ensureTrackStrip = vi.fn();
        injectDependencies(ensureTrackStrips, {
            trackStore: { value: null } as never,
            ensureTrackStrip,
            setTrackGain: vi.fn(),
            setTrackPan: vi.fn(),
            setTrackMute: vi.fn(),
            setTrackOutput: vi.fn(),
            addDeviceToStrip: vi.fn(),
            updateDeviceParam: vi.fn(),
            ensureBusStrip: vi.fn(),
            setBusGain: vi.fn(),
            setSend: vi.fn(),
        });

        ensureTrackStrips();

        expect(ensureTrackStrip).not.toHaveBeenCalled();
    });

    it('sets up bus strips, audio strips, devices and sends', () => {
        const ensureBusStrip = vi.fn();
        const setBusGain = vi.fn();
        const ensureTrackStrip = vi.fn();
        const setTrackGain = vi.fn();
        const setTrackPan = vi.fn();
        const setTrackMute = vi.fn();
        const setTrackOutput = vi.fn();
        const addDeviceToStrip = vi.fn();
        const updateDeviceParam = vi.fn();
        const setSend = vi.fn();

        injectDependencies(ensureTrackStrips, {
            trackStore: {
                value: {
                    tracks: [
                        { id: 'bus-1', kind: 'bus', gain: 0.8, pan: 0, muted: false, soloed: false, devices: [], sends: [], outputId: 'master' },
                        {
                            id: 't1',
                            kind: 'audio',
                            gain: 1,
                            pan: 0,
                            muted: false,
                            soloed: false,
                            outputId: 'master',
                            devices: [
                                {
                                    id: 'd1',
                                    type: 'gain',
                                    parameterValues: { gain: 0.5 },
                                },
                            ],
                            sends: [{ busId: 'bus-1', level: 0.3, preFader: false }],
                        },
                    ],
                },
            } as never,
            ensureTrackStrip,
            setTrackGain,
            setTrackPan,
            setTrackMute,
            setTrackOutput,
            addDeviceToStrip,
            updateDeviceParam,
            ensureBusStrip,
            setBusGain,
            setSend,
        });

        ensureTrackStrips();

        expect(ensureBusStrip).toHaveBeenCalledWith('bus-1');
        expect(setBusGain).toHaveBeenCalledWith('bus-1', 0.8);
        expect(ensureTrackStrip).toHaveBeenCalledWith('t1');
        expect(addDeviceToStrip).toHaveBeenCalledWith('t1', 'd1', 'gain');
        expect(updateDeviceParam).toHaveBeenCalledWith('t1', 'd1', 'gain', 0.5);
        expect(setSend).toHaveBeenCalledWith('t1', 'bus-1', 0.3, false);
    });

    it('mutes non-soloed tracks when any track is soloed', () => {
        const setTrackMute = vi.fn();
        injectDependencies(ensureTrackStrips, {
            trackStore: {
                value: {
                    tracks: [
                        { id: 't1', kind: 'audio', gain: 1, pan: 0, muted: false, soloed: true, outputId: 'master', devices: [], sends: [] },
                        { id: 't2', kind: 'audio', gain: 1, pan: 0, muted: false, soloed: false, outputId: 'master', devices: [], sends: [] },
                    ],
                },
            } as never,
            ensureTrackStrip: vi.fn(),
            setTrackGain: vi.fn(),
            setTrackPan: vi.fn(),
            setTrackMute,
            setTrackOutput: vi.fn(),
            addDeviceToStrip: vi.fn(),
            updateDeviceParam: vi.fn(),
            ensureBusStrip: vi.fn(),
            setBusGain: vi.fn(),
            setSend: vi.fn(),
        });

        ensureTrackStrips();

        // The non-soloed track gets muted
        expect(setTrackMute).toHaveBeenCalledWith('t2', true, 1);
    });
});
