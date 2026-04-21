import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getAllTracks } from '#/modules/Arrangement/useCases';
import { getTrackStrip } from '#/modules/AudioEngine/useCases';

import { type ToasterKit, type PadState } from '../../models/ToasterKit';
import { loadKit } from '../../stores/toasterStore';
import { getToasterControls, loadToasterKitPreset, TOASTER_ENGINE_MAP } from '../loadToasterKit';

vi.mock('#/modules/Arrangement/useCases', () => ({
    getAllTracks: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getTrackStrip: vi.fn(),
}));

vi.mock('../../stores/toasterStore', () => ({
    loadKit: vi.fn(),
}));

function minimalPad(overrides: Partial<PadState> = {}): PadState {
    return {
        id: 0,
        name: 'Kick',
        color: '#000',
        engineType: 'kick-808',
        chokeGroup: 0,
        midiNote: 36,
        volume: 1,
        pan: 0,
        muted: false,
        soloed: false,
        tune: 0,
        decay: 0.5,
        tone: 0.5,
        drive: 0,
        filterCutoff: 10_000,
        filterResonance: 1,
        sendReverb: 0,
        sendDelay: 0,
        engineParams: {},
        ...overrides,
    };
}

function minimalKit(overrides: Partial<ToasterKit> = {}): ToasterKit {
    return {
        version: 1,
        name: 'Test',
        pads: [minimalPad()],
        patterns: [],
        activePatternId: 'p1',
        swing: 0,
        masterGain: 0.9,
        reverbMix: 0.1,
        reverbDecay: 0.5,
        delayTime: 100,
        delayFeedback: 0.1,
        delayMix: 0.2,
        lofiBits: 16,
        lofiRate: 44_100,
        lofiMix: 0,
        macros: [0, 0, 0, 0, 0, 0, 0, 0],
        ...overrides,
    };
}

function wireToasterMocks(setParam: ReturnType<typeof vi.fn>, setPadParam: ReturnType<typeof vi.fn>) {
    vi.mocked(getAllTracks).mockReturnValue([
        {
            id: 't1',
            devices: [
                {
                    id: 'd1',
                    name: 'Toaster',
                    type: 'toaster',
                    bypassed: false,
                    parameterValues: {},
                },
            ],
        } as any,
    ]);
    vi.mocked(getTrackStrip).mockReturnValue({
        deviceNodes: [
            {
                deviceId: 'd1',
                type: 'toaster',
                nodes: [],
                inputNode: {} as AudioNode,
                outputNode: {} as AudioNode,
                toasterControls: {
                    ready: true,
                    setParam,
                    setPadParam,
                    noteOn: vi.fn(),
                    noteOff: vi.fn(),
                    setBypass: vi.fn(),
                    destroy: vi.fn(),
                },
            },
        ],
    } as any);
}

describe('TOASTER_ENGINE_MAP', () => {
    it('should map kick and snare drum types to distinct engine indices', () => {
        expect(TOASTER_ENGINE_MAP['kick-808']).toBe(13);
        expect(TOASTER_ENGINE_MAP['snare-808']).toBe(15);
        expect(TOASTER_ENGINE_MAP['kick-808']).not.toBe(TOASTER_ENGINE_MAP['kick-909']);
    });

    it('should map hihat types to the same engine index as documented', () => {
        expect(TOASTER_ENGINE_MAP['hihat-closed']).toBe(TOASTER_ENGINE_MAP['hihat-open']);
    });
});

describe('getToasterControls', () => {
    beforeEach(() => {
        vi.mocked(getAllTracks).mockReset();
        vi.mocked(getTrackStrip).mockReset();
    });

    it('should return null when there is no toaster track', () => {
        vi.mocked(getAllTracks).mockReturnValue([]);

        expect(getToasterControls()).toBeNull();
    });

    it('should return controls when a ready toaster device exists on the strip', () => {
        const setParam = vi.fn();
        const setPadParam = vi.fn();
        wireToasterMocks(setParam, setPadParam);

        const controls = getToasterControls();

        expect(controls).not.toBeNull();
        expect(controls?.setParam).toBe(setParam);
    });
});

describe('loadToasterKitPreset', () => {
    beforeEach(() => {
        vi.mocked(loadKit).mockReset();
        vi.mocked(getAllTracks).mockReset();
        vi.mocked(getTrackStrip).mockReset();
    });

    it('should call loadKit and forward kit-level params when controls exist', () => {
        const setParam = vi.fn();
        const setPadParam = vi.fn();
        wireToasterMocks(setParam, setPadParam);

        const kit = minimalKit();
        loadToasterKitPreset(kit);

        expect(loadKit).toHaveBeenCalledWith(kit);
        expect(setParam).toHaveBeenCalledWith('master_gain', kit.masterGain);
        expect(setParam).toHaveBeenCalledWith('reverb_mix', kit.reverbMix);
        expect(setPadParam).toHaveBeenCalledWith(0, 'engine_type', TOASTER_ENGINE_MAP['kick-808']);
    });

    it('should set open pad param for hihat-open vs hihat-closed', () => {
        const setParam = vi.fn();
        const setPadParam = vi.fn();
        wireToasterMocks(setParam, setPadParam);

        const kit = minimalKit({
            pads: [minimalPad({ engineType: 'hihat-open' }), minimalPad({ id: 1, engineType: 'hihat-closed' })],
        });
        loadToasterKitPreset(kit);

        expect(setPadParam).toHaveBeenCalledWith(0, 'open', 1);
        expect(setPadParam).toHaveBeenCalledWith(1, 'open', 0);
    });

    it('should not throw when controls are unavailable', () => {
        vi.mocked(getAllTracks).mockReturnValue([]);

        const kit = minimalKit();
        expect(() => loadToasterKitPreset(kit)).not.toThrow();
        expect(loadKit).toHaveBeenCalledWith(kit);
    });
});
