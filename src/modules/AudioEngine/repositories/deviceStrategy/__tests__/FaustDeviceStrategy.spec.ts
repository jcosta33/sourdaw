import { describe, it, expect, vi, beforeEach } from 'vitest';

import { logger } from '#/infra/logger/appLogger';

import { type AutomationLane } from '../../../models/AutomationViewTypes';
import { type Device } from '../../../models/TrackViewTypes';
import { scheduleTrackAutomation } from '../../offlineScheduler/automationScheduling';
import { FaustDeviceStrategy, createFaustStrategy } from '../FaustDeviceStrategy';

type FaustNodeLike = ConstructorParameters<typeof FaustDeviceStrategy>[1];

function make_audio_node(): AudioNode {
    return {
        context: {} as BaseAudioContext,
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 2,
        channelCountMode: 'max',
        channelInterpretation: 'speakers',
        connect: vi.fn(),
        disconnect: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(() => true),
    };
}

describe('FaustDeviceStrategy', () => {
    it('should forward setParam to faustNode.setParamValue when present', () => {
        const setParamValue = vi.fn();
        const faustNode = Object.assign(make_audio_node(), { setParamValue });
        const offlineNode = {
            inputNode: {} as AudioNode,
            outputNode: {} as AudioNode,
            nodes: [faustNode],
        };
        const strategy = new FaustDeviceStrategy(offlineNode, faustNode, false, 48_000);

        strategy.setParam('freq', 0.5);

        expect(setParamValue).toHaveBeenCalledWith('freq', 0.5);
    });

    it('should not throw when setParamValue is missing', () => {
        const offlineNode = {
            inputNode: {} as AudioNode,
            outputNode: {} as AudioNode,
            nodes: [make_audio_node()],
        };
        const strategy = new FaustDeviceStrategy(offlineNode, make_audio_node() as FaustNodeLike, false, 48_000);
        expect(() => strategy.setParam('x', 1)).not.toThrow();
    });

    // The note surface is gated on the registered `isInstrument` flag, not on
    // the `faust-` prefix and not on `wamControls.keyOn` (the factory defines
    // that wrapper for every module, effect or not).
    it('offers a note surface only to a module registered as an instrument', () => {
        const keyOn = vi.fn();
        const keyOff = vi.fn();
        const faustNode = Object.assign(make_audio_node(), { setParamValue: vi.fn() });
        const offlineNode = {
            inputNode: faustNode as AudioNode,
            outputNode: faustNode as AudioNode,
            nodes: [faustNode as AudioNode],
            wamControls: { setParam: vi.fn(), scheduleParam: vi.fn(), keyOn, keyOff },
        };

        const effect = new FaustDeviceStrategy(offlineNode, faustNode, false, 48_000);
        const instrument = new FaustDeviceStrategy(offlineNode, faustNode, true, 48_000);

        expect(effect.acceptsNotes).toBe(false);
        expect(instrument.acceptsNotes).toBe(true);

        // Frame 24000 at 48kHz is 0.5s — the seconds the Faust scheduler wants.
        instrument.noteOn({ noteOrPad: 64, velocity: 100, sampleFrame: 24_000 });
        instrument.noteOff({ noteOrPad: 64, sampleFrame: 48_000 });

        expect(keyOn).toHaveBeenCalledWith(0, 64, 100, 0.5);
        expect(keyOff).toHaveBeenCalledWith(0, 64, 0, 1);
    });
});

describe('createFaustStrategy', () => {
    const createFaustDevice = vi.fn();

    beforeEach(() => {
        createFaustDevice.mockReset();
    });

    it('should throw when createFaustDevice returns null', async () => {
        createFaustDevice.mockResolvedValue(null);
        const device: Device = {
            id: 'd1',
            name: 'F',
            type: 'faust-x',
            bypassed: false,
            parameterValues: {},
        };
        await expect(
            createFaustStrategy({
                ctx: { sampleRate: 48_000 } as BaseAudioContext,
                device,
                createFaustDevice,
                isFaustInstrument: () => false,
            })
        ).rejects.toThrow(/Failed to create Faust device/);
    });

    it('should apply initial parameter values on the Faust node', async () => {
        const setParamValue = vi.fn();
        const faustNode = { setParamValue };
        const offlineNode = {
            inputNode: faustNode as unknown as AudioNode,
            outputNode: faustNode as unknown as AudioNode,
            nodes: [faustNode as unknown as AudioNode],
        };
        createFaustDevice.mockResolvedValue(offlineNode);
        const device: Device = {
            id: 'd1',
            name: 'F',
            type: 'faust-x',
            bypassed: false,
            parameterValues: { gain: 0.25 },
        };
        const ctx = { sampleRate: 48_000 } as BaseAudioContext;
        await createFaustStrategy({ ctx, device, createFaustDevice, isFaustInstrument: () => false });
        expect(createFaustDevice).toHaveBeenCalledWith({ ctx, faustModuleId: 'faust-x' });
        expect(setParamValue).toHaveBeenCalledWith('gain', 0.25);
    });

    it('carries the registered instrument flag onto the strategy it builds', async () => {
        const faustNode = { setParamValue: vi.fn() };
        createFaustDevice.mockResolvedValue({
            inputNode: faustNode as unknown as AudioNode,
            outputNode: faustNode as unknown as AudioNode,
            nodes: [faustNode as unknown as AudioNode],
        });
        const device: Device = {
            id: 'd1',
            name: 'Supersaw Unison',
            type: 'faust-supersaw-unison',
            bypassed: false,
            parameterValues: {},
        };
        const isFaustInstrument = vi.fn((moduleId: string) => moduleId === 'faust-supersaw-unison');

        const strategy = await createFaustStrategy({
            ctx: { sampleRate: 48_000 } as BaseAudioContext,
            device,
            createFaustDevice,
            isFaustInstrument,
        });

        expect(isFaustInstrument).toHaveBeenCalledWith('faust-supersaw-unison');
        expect(strategy.acceptsNotes).toBe(true);
    });
});

function make_faust_param() {
    return {
        value: 0,
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        setTargetAtTime: vi.fn(),
    };
}

// A Faust AudioWorkletNode stand-in: params keyed by their full Faust address.
function make_faust_strategy(addresses: string[]) {
    const params = new Map(addresses.map((address) => [address, make_faust_param()] as const));
    const faustNode = Object.assign(make_audio_node(), { setParamValue: vi.fn(), parameters: params });
    const offlineNode = {
        inputNode: {} as AudioNode,
        outputNode: {} as AudioNode,
        nodes: [faustNode],
    };
    return {
        strategy: new FaustDeviceStrategy(offlineNode, faustNode as unknown as FaustNodeLike, false, 48_000),
        params,
    };
}

function make_lane(overrides: Partial<AutomationLane>): AutomationLane {
    return {
        id: 'lane-1',
        trackId: 'track-1',
        parameterId: 'gain',
        parameterName: 'Cutoff',
        points: [],
        enabled: true,
        minValue: 0,
        maxValue: 20_000,
        ...overrides,
    };
}

describe('FaustDeviceStrategy.resolveOfflineAutomation', () => {
    it('resolves a bare parameter id to the full-path Faust AudioParam', () => {
        const { strategy, params } = make_faust_strategy(['/reverb/cutoff']);

        const binding = strategy.resolveOfflineAutomation('cutoff');

        expect(binding?.kind).toBe('audioParam');
        if (binding?.kind !== 'audioParam') {
            throw new Error('expected an audioParam binding');
        }
        expect(binding.targets).toEqual([{ audioParam: params.get('/reverb/cutoff'), scale: 1, offset: 0 }]);
    });

    it('resolves an exact full-path parameter id directly', () => {
        const { strategy, params } = make_faust_strategy(['/reverb/cutoff']);

        const binding = strategy.resolveOfflineAutomation('/reverb/cutoff');

        expect(binding?.kind === 'audioParam' && binding.targets[0]?.audioParam).toBe(params.get('/reverb/cutoff'));
    });

    it('returns null for a parameter the Faust node does not expose', () => {
        const { strategy } = make_faust_strategy(['/reverb/cutoff']);

        expect(strategy.resolveOfflineAutomation('resonance')).toBeNull();
    });

    it('keeps the first address and warns on an ambiguous bare param name', () => {
        const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        const { strategy, params } = make_faust_strategy(['/a/cutoff', '/b/cutoff']);

        const binding = strategy.resolveOfflineAutomation('cutoff');

        // First address wins; the shadowed duplicate is warned, mirroring the live cache.
        expect(binding?.kind === 'audioParam' && binding.targets[0]?.audioParam).toBe(params.get('/a/cutoff'));
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Duplicate bare param'));
        warnSpy.mockRestore();
    });

    // OE-3 red-first: a Faust device sits outside the hardcoded offline param map
    // and exposes no scheduleParam, so before this capability its parameter
    // automation was frozen at the create-time snapshot offline. Drive the full
    // offline scheduler and assert the Faust AudioParam receives the real
    // interpolated ramp — not a single flat value.
    it('renders offline parameter automation as real ramped values, not a frozen snapshot', () => {
        const { strategy, params } = make_faust_strategy(['/reverb/cutoff']);
        const cutoff = params.get('/reverb/cutoff')!;

        scheduleTrackAutomation(
            [
                make_lane({
                    parameterId: 'faust-1:cutoff',
                    points: [
                        { beat: 0, value: 200, curve: 'linear', tension: 0 },
                        { beat: 4, value: 2_000, curve: 'linear', tension: 0 },
                    ],
                }),
            ],
            'track-1',
            { gain: make_faust_param() } as unknown as GainNode,
            { pan: make_faust_param() } as unknown as StereoPannerNode,
            [{ deviceId: 'faust-1', deviceType: 'faust-reverb', strategy }],
            10,
            120,
            []
        );

        // 120 bpm → beatToSeconds(beat) === beat / 2. AU-2: device automation is
        // slewed offline (matching the live path), so the ramp is not a raw jump
        // — it seeds at 200, glides through intermediate values, and settles
        // exactly on 2000 (never a frozen snapshot).
        expect(cutoff.setValueAtTime).toHaveBeenCalledWith(200, 0);
        const ramps = cutoff.linearRampToValueAtTime.mock.calls.map((call) => call[0] as number);
        expect(ramps.at(-1)).toBeCloseTo(2_000, 6);
        expect(ramps.some((value) => value > 201 && value < 1_999)).toBe(true);
    });
});
