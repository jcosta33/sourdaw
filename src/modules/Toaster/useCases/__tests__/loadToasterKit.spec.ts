import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type ToasterKit, type PadState } from '../../models/ToasterKit';
import { loadKit } from '../../stores/toasterStore';
import { getToasterControls } from '../getToasterControls';
import { loadToasterKitPreset } from '../loadToasterKit';
import { TOASTER_ENGINE_MAP } from '../toasterEngineMap';

type MockTrack = {
    id: string;
    devices: Array<{
        id: string;
        name: string;
        type: string;
        bypassed: boolean;
        parameterValues: Record<string, number>;
    }>;
};

type SetParam = (name: string, value: number) => void;
type SetPadParam = (pad: number, name: string, value: number) => void;

type MockToasterControls = {
    ready: boolean;
    setParam: SetParam;
    setPadParam: SetPadParam;
};

type MockTrackStrip = {
    deviceNodes: Array<{
        deviceId: string;
        type: string;
        toasterControls?: MockToasterControls;
    }>;
};

const getAllTracksMock = vi.hoisted(() => vi.fn<() => MockTrack[]>(() => []));
const getTrackStripMock = vi.hoisted(() => vi.fn<(trackId: string) => MockTrackStrip | undefined>());
const resolveEligibleDeviceWriteTargetMock = vi.hoisted(() =>
    vi.fn<
        (
            deviceId: string
        ) => { status: 'eligible'; trackId: string; deviceId: string } | { status: 'missing' | 'ineligible' }
    >()
);

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    resolveEligibleDeviceWriteTarget: resolveEligibleDeviceWriteTargetMock,
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    getAllTracks: getAllTracksMock,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getTrackStrip: getTrackStripMock,
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

function wireToasterMocks(
    setParam: ReturnType<typeof vi.fn<SetParam>>,
    setPadParam: ReturnType<typeof vi.fn<SetPadParam>>
) {
    getAllTracksMock.mockReturnValue([
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
        },
    ]);
    getTrackStripMock.mockReturnValue({
        deviceNodes: [
            {
                deviceId: 'd1',
                type: 'toaster',
                toasterControls: {
                    ready: true,
                    setParam,
                    setPadParam,
                },
            },
        ],
    });
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
        getAllTracksMock.mockReset();
        getAllTracksMock.mockReturnValue([]);
        getTrackStripMock.mockReset();
    });

    it('should return null when there is no toaster track', () => {
        getAllTracksMock.mockReturnValue([]);

        expect(getToasterControls('d1')).toBeNull();
    });

    it('should return controls when a ready toaster device exists on the strip', () => {
        const setParam = vi.fn<SetParam>();
        const setPadParam = vi.fn<SetPadParam>();
        wireToasterMocks(setParam, setPadParam);

        const controls = getToasterControls('d1');

        expect(controls).not.toBeNull();
        expect(controls?.setParam).toBe(setParam);
    });

    // Regression — controls must be scoped to the requested deviceId. The old
    // behavior returned the FIRST toaster device, so a second instance's preset
    // load was routed onto the first instance's worklet.
    it('returns null for a deviceId that is not the first toaster device', () => {
        const setParam = vi.fn<SetParam>();
        const setPadParam = vi.fn<SetPadParam>();
        wireToasterMocks(setParam, setPadParam);

        expect(getToasterControls('not-d1')).toBeNull();
    });
});

describe('loadToasterKitPreset', () => {
    beforeEach(() => {
        vi.mocked(loadKit).mockReset();
        resolveEligibleDeviceWriteTargetMock.mockReset();
        resolveEligibleDeviceWriteTargetMock.mockReturnValue({
            status: 'eligible',
            trackId: 't1',
            deviceId: 'd1',
        });
        getAllTracksMock.mockReset();
        getAllTracksMock.mockReturnValue([]);
        getTrackStripMock.mockReset();
    });

    it('should call loadKit and forward kit-level params when controls exist', () => {
        const setParam = vi.fn<SetParam>();
        const setPadParam = vi.fn<SetPadParam>();
        wireToasterMocks(setParam, setPadParam);

        const kit = minimalKit();
        loadToasterKitPreset('d1', kit);

        expect(loadKit).toHaveBeenCalledWith('d1', kit);
        expect(setParam).toHaveBeenCalledWith('master_gain', kit.masterGain);
        expect(setParam).toHaveBeenCalledWith('reverb_mix', kit.reverbMix);
        expect(setPadParam).toHaveBeenCalledWith(0, 'engine_type', TOASTER_ENGINE_MAP['kick-808']);

        const resolutionCallOrder = resolveEligibleDeviceWriteTargetMock.mock.invocationCallOrder[0];
        const loadKitCallOrder = vi.mocked(loadKit).mock.invocationCallOrder[0];
        const trackLookupCallOrder = getAllTracksMock.mock.invocationCallOrder[0];
        const firstSetParamCallOrder = setParam.mock.invocationCallOrder[0];
        if (
            resolutionCallOrder === undefined ||
            loadKitCallOrder === undefined ||
            trackLookupCallOrder === undefined ||
            firstSetParamCallOrder === undefined
        ) {
            throw new Error('Expected authorization, store, lookup, and runtime effects');
        }
        expect(resolutionCallOrder).toBeLessThan(loadKitCallOrder);
        expect(loadKitCallOrder).toBeLessThan(trackLookupCallOrder);
        expect(loadKitCallOrder).toBeLessThan(firstSetParamCallOrder);
    });

    it.each(['missing', 'ineligible'] as const)(
        'rejects a %s owner before store, lookup, or runtime effects',
        (status) => {
            const setParam = vi.fn<SetParam>();
            const setPadParam = vi.fn<SetPadParam>();
            wireToasterMocks(setParam, setPadParam);
            resolveEligibleDeviceWriteTargetMock.mockReturnValue({ status });

            loadToasterKitPreset('d1', minimalKit());

            expect(resolveEligibleDeviceWriteTargetMock).toHaveBeenCalledWith('d1');
            expect(loadKit).not.toHaveBeenCalled();
            expect(getAllTracksMock).not.toHaveBeenCalled();
            expect(getTrackStripMock).not.toHaveBeenCalled();
            expect(setParam).not.toHaveBeenCalled();
            expect(setPadParam).not.toHaveBeenCalled();
        }
    );

    it('should set open pad param for hihat-open vs hihat-closed', () => {
        const setParam = vi.fn<SetParam>();
        const setPadParam = vi.fn<SetPadParam>();
        wireToasterMocks(setParam, setPadParam);

        const kit = minimalKit({
            pads: [minimalPad({ engineType: 'hihat-open' }), minimalPad({ id: 1, engineType: 'hihat-closed' })],
        });
        loadToasterKitPreset('d1', kit);

        expect(setPadParam).toHaveBeenCalledWith(0, 'open', 1);
        expect(setPadParam).toHaveBeenCalledWith(1, 'open', 0);
    });

    it('should forward pad engineParams entries', () => {
        const setParam = vi.fn<SetParam>();
        const setPadParam = vi.fn<SetPadParam>();
        wireToasterMocks(setParam, setPadParam);

        const kit = minimalKit({
            pads: [minimalPad({ engineParams: { snap: 0.75, transient: 0.25 } })],
        });
        loadToasterKitPreset('d1', kit);

        const engineParamCalls = setPadParam.mock.calls.filter(([, name]) => name === 'snap' || name === 'transient');
        expect(engineParamCalls).toEqual([
            [0, 'snap', 0.75],
            [0, 'transient', 0.25],
        ]);
    });

    it('should not throw when controls are unavailable', () => {
        getAllTracksMock.mockReturnValue([]);

        const kit = minimalKit();
        expect(() => loadToasterKitPreset('d1', kit)).not.toThrow();
        expect(loadKit).toHaveBeenCalledWith('d1', kit);
    });
});
