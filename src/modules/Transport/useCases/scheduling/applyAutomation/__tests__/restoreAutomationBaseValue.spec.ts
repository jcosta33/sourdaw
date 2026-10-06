import { describe, it, expect, vi, beforeEach } from 'vitest';

import { scheduleSendAutomation, updateDeviceParam, updateMidiFxParam } from '#/modules/AudioEngine/useCases';
import { applyFermenterRuntimeParam } from '#/modules/Fermenter/useCases';

import { restoreAutomationBaseValue } from '../restoreAutomationBaseValue';

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/Arrangement/stores')>();
    return {
        ...mod,
        resolveEligibleDeviceWriteTarget: vi.fn((deviceId: string) => ({
            status: 'eligible',
            trackId: 'track-1',
            deviceId,
        })),
    };
});
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/AudioEngine/useCases')>();
    return {
        ...mod,
        scheduleSendAutomation: vi.fn(),
        scheduleTrackGain: vi.fn(),
        scheduleTrackPan: vi.fn(),
        updateDeviceParam: vi.fn(),
        updateMidiFxParam: vi.fn(),
    };
});
vi.mock('#/modules/Fermenter/useCases', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/Fermenter/useCases')>();
    return {
        ...mod,
        applyFermenterRuntimeParam: vi.fn(),
    };
});
type RestorableTrack = Parameters<typeof restoreAutomationBaseValue>[0]['track'];

function trackWithDeviceParam(paramId: string, baseValue: number): RestorableTrack {
    return {
        gain: 0.4,
        pan: 12,
        // `dutch-oven` declares both halves of the contract against real product
        // data: `shimmer_pitch` is automatable: false, `mix` is automatable.
        devices: [{ id: 'ov-1', type: 'dutch-oven', parameterValues: { [paramId]: baseValue } }],
    };
}

describe('restoreAutomationBaseValue', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('writes the persisted base back for an automatable device parameter', () => {
        restoreAutomationBaseValue({
            lane: { trackId: 'track-1', parameterId: 'ov-1:mix' },
            track: trackWithDeviceParam('mix', 0.42),
            landTime: 7,
        });

        expect(updateDeviceParam).toHaveBeenCalledWith('track-1', 'ov-1', 'mix', 0.42);
    });

    it('restores the persisted send level on the compensated clock after its lane stops driving', () => {
        restoreAutomationBaseValue({
            lane: { trackId: 'track-1', parameterId: 'send:bus-hall' },
            track: {
                gain: 0.4,
                pan: 12,
                devices: [],
                sends: [{ busId: 'bus-hall', level: 0.5, preFader: true }],
            },
            landTime: 7,
        });

        expect(scheduleSendAutomation).toHaveBeenCalledWith('track-1', 'bus-hall', 0.5, 7);
    });

    it('restores a Fermenter base through the runtime-only mapped path', () => {
        const track: RestorableTrack = {
            gain: 0.4,
            pan: 12,
            devices: [{ id: 'fermenter-1', type: 'fermenter', parameterValues: { filterCutoff: 840 } }],
        };

        restoreAutomationBaseValue({
            lane: { trackId: 'track-1', parameterId: 'fermenter-1:filterCutoff' },
            track,
            landTime: 7,
        });

        expect(applyFermenterRuntimeParam).toHaveBeenCalledWith({
            deviceId: 'fermenter-1',
            paramId: 'filterCutoff',
            value: 840,
        });
        expect(updateDeviceParam).not.toHaveBeenCalled();
    });

    it('does not restore a parameter the descriptor marks non-automatable', () => {
        restoreAutomationBaseValue({
            lane: { trackId: 'track-1', parameterId: 'ov-1:shimmer_pitch' },
            track: trackWithDeviceParam('shimmer_pitch', 0.42),
            landTime: 7,
        });

        // A lane that may not drive the parameter may not restore it either —
        // restoring would be the same unauthorised write arriving one tick after
        // the gate that refused it.
        expect(updateDeviceParam).not.toHaveBeenCalled();
    });

    it('does not restore a MIDI-FX parameter — it is not an automation target (#4789)', () => {
        // A bare parameter id that resolves no device used to fall through to a
        // MIDI-FX base restore, but nothing consumes MIDI-FX parameter values —
        // the drive path writes nothing for them either — so there is no base
        // to restore and the restore must write nothing. The track carries the
        // MIDI-FX and its base, the way production truth does.
        const track = {
            gain: 0.4,
            pan: 12,
            devices: [],
            midiFx: [{ id: 'arp-1', type: 'arp', parameterValues: { rate: 0.25 } }],
        };
        restoreAutomationBaseValue({
            lane: { trackId: 'track-1', parameterId: 'rate' },
            track,
            landTime: 7,
        });

        expect(updateDeviceParam).not.toHaveBeenCalled();
        // The refusal must hold against the keyed write too: the track carries
        // the MIDI-FX holding the lane's parameter, the way production truth
        // does, and a resurrected restore loop would land exactly here.
        expect(updateMidiFxParam).not.toHaveBeenCalled();
    });
});

/**
 * F3: the restore is a **delivery**, so it is held to the delivery law.
 *
 * The stored base is not guaranteed integral even for a parameter the descriptor
 * declares stepped: `setDeviceParameter` clamps and never rounds, and the MIDI
 * CC route (`ControlSurface` `scaleMidiValue` → `setDeviceParameter`) scales a
 * 0..127 controller straight across the declared span — CC 64 on
 * `bacteria/bitDepth` (1..24) persists 12.59. A lane driving that parameter then
 * delivers integers, and the tick the lane stops driving used to hand the
 * worklet 12.59 back: an index no `match` arm in Rust names, arriving as an
 * audible discontinuity exactly at the driving → not-driving edge.
 *
 * The stored base is deliberately left alone. Rounding it would rewrite project
 * data, which is the boundary this whole change draws — quantise what leaves for
 * the DSP, never what is persisted.
 */
describe('restoreAutomationBaseValue — stepped device parameters', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    function trackWithBacteriaParam(paramId: string, baseValue: number): RestorableTrack {
        return {
            gain: 0.4,
            pan: 12,
            devices: [{ id: 'bact-1', type: 'bacteria', parameterValues: { [paramId]: baseValue } }],
        };
    }

    it('delivers the nearest legal index when the stored base is fractional', () => {
        const track = trackWithBacteriaParam('bitDepth', 12.59);

        restoreAutomationBaseValue({
            lane: { trackId: 'track-1', parameterId: 'bact-1:bitDepth' },
            track,
            landTime: 7,
        });

        // 12.59 before the fix. 13 and 12 are both legal and audibly different
        // bit depths, so this names the two values it decides between.
        expect(updateDeviceParam).toHaveBeenCalledWith('track-1', 'bact-1', 'bitDepth', 13);
        // And the persisted base is untouched — the restore is a delivery, not a
        // rewrite of project truth.
        expect(track.devices[0]!.parameterValues.bitDepth).toBe(12.59);
    });

    it('delivers a Fermenter stepped base as an integer through the runtime-only path', () => {
        // The Fermenter arm is a separate dispatch (`applyFermenterRuntimeParam`,
        // camelCase → snake_case), so it needs its own case. `oscEngine` defaults
        // to 0 where rounded and raw agree; 4.6 decides between engines 4 and 5.
        const track: RestorableTrack = {
            gain: 0.4,
            pan: 12,
            devices: [{ id: 'fermenter-1', type: 'fermenter', parameterValues: { oscEngine: 4.6 } }],
        };

        restoreAutomationBaseValue({
            lane: { trackId: 'track-1', parameterId: 'fermenter-1:oscEngine' },
            track,
            landTime: 7,
        });

        expect(applyFermenterRuntimeParam).toHaveBeenCalledWith({
            deviceId: 'fermenter-1',
            paramId: 'oscEngine',
            value: 5,
        });
        expect(track.devices[0]!.parameterValues.oscEngine).toBe(4.6);
    });

    it('leaves a float base fractional on restore', () => {
        // The complement: `bacteria/mix` is `float` (step 0.01), and rounding it
        // would restore a continuous wet/dry as fully wet or fully dry.
        restoreAutomationBaseValue({
            lane: { trackId: 'track-1', parameterId: 'bact-1:mix' },
            track: trackWithBacteriaParam('mix', 0.42),
            landTime: 7,
        });

        expect(updateDeviceParam).toHaveBeenCalledWith('track-1', 'bact-1', 'mix', 0.42);
    });
});
