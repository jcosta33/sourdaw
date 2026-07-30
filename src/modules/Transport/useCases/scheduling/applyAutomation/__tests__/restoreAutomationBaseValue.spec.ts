import { describe, it, expect, vi, beforeEach } from 'vitest';

import { updateDeviceParam, updateMidiFxParam } from '#/modules/AudioEngine/useCases';
import { applyFermenterRuntimeParam, setFermenterMappedParam } from '#/modules/Fermenter/useCases';

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
        setFermenterMappedParam: vi.fn(),
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
        midiFx: [],
    };
}

function trackWithMidiFxParam(paramId: string, baseValue: number): RestorableTrack {
    return {
        gain: 0.4,
        pan: 12,
        devices: [],
        // No shipped MIDI FX type declares a descriptor yet, so `dutch-oven`
        // stands in for the day one does — the branch reads `fx.type`
        // generically, and this holds it to the same law rather than to the
        // absence of data.
        midiFx: [{ id: 'fx-1', type: 'dutch-oven', parameterValues: { [paramId]: baseValue } }],
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

    it('restores a Fermenter base through the runtime path without persisting it again', () => {
        const track = trackWithDeviceParam('filterCutoff', 420);
        track.devices[0] = {
            id: 'fermenter-1',
            type: 'fermenter',
            parameterValues: { filterCutoff: 420 },
        };

        restoreAutomationBaseValue({
            lane: { trackId: 'track-1', parameterId: 'fermenter-1:filterCutoff' },
            track,
            landTime: 7,
        });

        expect(applyFermenterRuntimeParam).toHaveBeenCalledWith({
            trackId: 'track-1',
            deviceId: 'fermenter-1',
            paramId: 'filterCutoff',
            value: 420,
        });
        expect(setFermenterMappedParam).not.toHaveBeenCalled();
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

    it('writes the persisted base back for an automatable MIDI-FX parameter', () => {
        restoreAutomationBaseValue({
            lane: { trackId: 'track-1', parameterId: 'mix' },
            track: trackWithMidiFxParam('mix', 0.31),
            landTime: 7,
        });

        expect(updateMidiFxParam).toHaveBeenCalledWith('track-1', 'fx-1', 'mix', 0.31);
    });

    it('does not restore a non-automatable MIDI-FX parameter', () => {
        restoreAutomationBaseValue({
            lane: { trackId: 'track-1', parameterId: 'shimmer_pitch' },
            track: trackWithMidiFxParam('shimmer_pitch', 0.31),
            landTime: 7,
        });

        expect(updateMidiFxParam).not.toHaveBeenCalled();
    });
});
