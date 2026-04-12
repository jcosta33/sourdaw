import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ensureTrackStrips } from '../ensureTrackStrips';
import { trackStore } from '#/modules/Arrangement/stores';
import {
    addDeviceToStrip,
    ensureTrackStrip,
    setTrackMute,
    setTrackOutput,
    updateDeviceParam,
} from '#/modules/AudioEngine/useCases';
import { ensureBusStrip, setBusGain, setSend } from '#/modules/Routing/useCases';

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/Arrangement/stores')>();
    return {
        ...mod,
        trackStore: { value: null },
    };
});

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/AudioEngine/useCases')>();
    return {
        ...mod,
        ensureTrackStrip: vi.fn(),
        setTrackGain: vi.fn(),
        setTrackPan: vi.fn(),
        setTrackMute: vi.fn(),
        setTrackOutput: vi.fn(),
        addDeviceToStrip: vi.fn(),
        updateDeviceParam: vi.fn(),
    };
});

vi.mock('#/modules/Routing/useCases', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/Routing/useCases')>();
    return {
        ...mod,
        ensureBusStrip: vi.fn(),
        setBusGain: vi.fn(),
        setSend: vi.fn(),
    };
});

describe('ensureTrackStrips', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        trackStore.value = null as any;
    });

    it('noops when no tracks are loaded', () => {
        ensureTrackStrips();
        expect(ensureTrackStrip).not.toHaveBeenCalled();
    });

    it('sets up bus strips, audio strips, devices and sends', () => {
        trackStore.value = {
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
        } as any;

        ensureTrackStrips();

        expect(ensureBusStrip).toHaveBeenCalledWith('bus-1');
        expect(setBusGain).toHaveBeenCalledWith('bus-1', 0.8);
        expect(ensureTrackStrip).toHaveBeenCalledWith('t1');
        expect(addDeviceToStrip).toHaveBeenCalledWith('t1', 'd1', 'gain');
        expect(updateDeviceParam).toHaveBeenCalledWith('t1', 'd1', 'gain', 0.5);
        expect(setSend).toHaveBeenCalledWith('t1', 'bus-1', 0.3, false);
    });

    it('mutes non-soloed tracks when any track is soloed', () => {
        trackStore.value = {
            tracks: [
                { id: 't1', kind: 'audio', gain: 1, pan: 0, muted: false, soloed: true, outputId: 'master', devices: [], sends: [] },
                { id: 't2', kind: 'audio', gain: 1, pan: 0, muted: false, soloed: false, outputId: 'master', devices: [], sends: [] },
            ],
        } as any;

        ensureTrackStrips();

        // The non-soloed track gets muted
        expect(setTrackMute).toHaveBeenCalledWith('t2', true, 1);
    });
});
