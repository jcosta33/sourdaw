import { describe, expect, it } from 'vitest';

import { dbToGain } from '#/utils/audioLevelLaw';

import { asBaseAudioContext, createMockAudioContext } from '../../../../../helpers/__tests__/audioContext.mock';
import { type AutomationLane } from '../../../models/AutomationViewTypes';
import { applyParams } from '../../applyParams';
import { createOfflineDeviceNode } from '../../deviceNodeFactory';
import { WebAudioDeviceStrategy } from '../../deviceStrategy/WebAudioDeviceStrategy';

import { scheduleTrackAutomationFixture } from './scheduleTrackAutomationFixture';

/**
 * Issue #3738: the offline automation binding must apply the same
 * per-parameter conversion the static applier applies. Before the fix the
 * scheduler wrote the lane's raw device numbers straight onto the AudioParam,
 * so automating a parameter changed the render law against the same knob set
 * statically: 0 dB became silence, −6 dB became amplification, 10 ms became
 * ten seconds.
 */
function webAudioEntry(deviceId: string, deviceType: string) {
    const node = createOfflineDeviceNode({ context: asBaseAudioContext(createMockAudioContext()), deviceType });
    if (!node) {
        throw new Error(`expected a ${deviceType} offline node`);
    }
    return { deviceId, deviceType, node, strategy: new WebAudioDeviceStrategy(node, deviceType) };
}

function makeLane(overrides: Partial<AutomationLane>): AutomationLane {
    return {
        id: overrides.id ?? 'lane-1',
        trackId: overrides.trackId ?? 'track-1',
        clipId: overrides.clipId,
        parameterId: overrides.parameterId ?? 'gain',
        parameterName: overrides.parameterName ?? 'Gain',
        points: overrides.points ?? [],
        enabled: overrides.enabled ?? true,
        minValue: overrides.minValue ?? 0,
        maxValue: overrides.maxValue ?? 1,
    };
}

function audioParamOf(entry: ReturnType<typeof webAudioEntry>, nodeIndex: number, property: string): AudioParam {
    const node = entry.node.nodes[nodeIndex];
    if (!node) {
        throw new Error(`expected a node at nodes[${nodeIndex}]`);
    }
    const candidate: unknown = Reflect.get(node, property);
    if (typeof candidate !== 'object' || candidate === null || !('value' in candidate)) {
        throw new Error(`expected an AudioParam at nodes[${nodeIndex}].${property}`);
    }
    return candidate as AudioParam;
}

/** The mock param's ramp values, read through its vitest mock. */
function rampValues(param: AudioParam): number[] {
    const calls = (param as unknown as { linearRampToValueAtTime: { mock: { calls: [number, number][] } } })
        .linearRampToValueAtTime.mock.calls;
    return calls.map((call) => call[0]);
}

function scheduleDeviceLane(entry: ReturnType<typeof webAudioEntry>, lane: AutomationLane): void {
    scheduleTrackAutomationFixture({
        lanes: [lane],
        trackId: 'track-1',
        trackGainNode: { gain: { setValueAtTime: () => {} } } as unknown as GainNode,
        trackPanNode: { pan: { setValueAtTime: () => {} } } as unknown as StereoPannerNode,
        deviceEntries: [entry],
        durationSeconds: 10,
        defaultTempo: 120,
        changes: [],
        regionStartSeconds: 64,
    });
}

describe('offline device automation applies the static parameter law (#3738)', () => {
    it('schedules a constant 0 dB gain-level lane as unity, not silence', () => {
        const entry = webAudioEntry('device-1', 'builtin-gain');
        scheduleDeviceLane(
            entry,
            makeLane({
                parameterId: 'device-1:gain-level',
                minValue: -60,
                maxValue: 24,
                points: [{ beat: 128, value: 0, curve: 'linear', tension: 0 }],
            })
        );
        expect(audioParamOf(entry, 0, 'gain').setValueAtTime).toHaveBeenCalledWith(dbToGain(0), 0);
    });

    it('schedules gain-level exactly as the static applier writes it', () => {
        const entry = webAudioEntry('device-1', 'builtin-gain');
        scheduleDeviceLane(
            entry,
            makeLane({
                parameterId: 'device-1:gain-level',
                minValue: -60,
                maxValue: 24,
                points: [{ beat: 128, value: -6, curve: 'linear', tension: 0 }],
            })
        );
        const staticNode = createOfflineDeviceNode({
            context: asBaseAudioContext(createMockAudioContext()),
            deviceType: 'builtin-gain',
        });
        applyParams(staticNode!, 'builtin-gain', { 'gain-level': -6 });
        // Same knob position, same law: the automated AudioParam value equals
        // the static write bit for bit, so enabling automation cannot change
        // the render.
        expect(audioParamOf(entry, 0, 'gain').setValueAtTime).toHaveBeenCalledWith(
            (staticNode!.nodes[0] as GainNode).gain.value,
            0
        );
    });

    it('slews a gain-level ride in device units and converts at write time', () => {
        const entry = webAudioEntry('device-1', 'builtin-gain');
        scheduleDeviceLane(
            entry,
            makeLane({
                parameterId: 'device-1:gain-level',
                minValue: -60,
                maxValue: 24,
                points: [
                    { beat: 128, value: 0, curve: 'step', tension: 0 },
                    { beat: 130, value: -6, curve: 'step', tension: 0 },
                ],
            })
        );
        const ramps = rampValues(audioParamOf(entry, 0, 'gain'));
        // The live IIR recurrence runs on the dB value and the conversion
        // happens once, at the write. Pre-step ticks hold 0 dB (linear 1);
        // the first moved tick is the first recurrence step: 0 + 0.4 × −6 =
        // −2.4 dB.
        const firstMoved = ramps.find((value) => value !== dbToGain(0));
        expect(firstMoved).toBeCloseTo(dbToGain(-2.4), 9);
        expect(ramps.at(-1)).toBeCloseTo(dbToGain(-6), 9);
    });

    it('schedules compressor times in seconds and makeup as linear gain', () => {
        const entry = webAudioEntry('device-1', 'builtin-compressor');
        scheduleDeviceLane(
            entry,
            makeLane({
                parameterId: 'device-1:comp-attack',
                minValue: 0.1,
                maxValue: 100,
                points: [{ beat: 128, value: 10, curve: 'linear', tension: 0 }],
            })
        );
        scheduleDeviceLane(
            entry,
            makeLane({
                id: 'lane-2',
                parameterId: 'device-1:comp-release',
                minValue: 10,
                maxValue: 1000,
                points: [{ beat: 128, value: 100, curve: 'linear', tension: 0 }],
            })
        );
        scheduleDeviceLane(
            entry,
            makeLane({
                id: 'lane-3',
                parameterId: 'device-1:comp-makeup',
                minValue: 0,
                maxValue: 30,
                points: [{ beat: 128, value: 6, curve: 'linear', tension: 0 }],
            })
        );
        expect(audioParamOf(entry, 0, 'attack').setValueAtTime).toHaveBeenCalledWith(10 / 1000, 0);
        expect(audioParamOf(entry, 0, 'release').setValueAtTime).toHaveBeenCalledWith(100 / 1000, 0);
        expect(audioParamOf(entry, 1, 'gain').setValueAtTime).toHaveBeenCalledWith(dbToGain(6), 0);
    });

    it('schedules a limiter ceiling lane in linear gain', () => {
        const entry = webAudioEntry('device-1', 'builtin-limiter');
        scheduleDeviceLane(
            entry,
            makeLane({
                parameterId: 'device-1:lim-ceiling',
                minValue: -3,
                maxValue: 0,
                points: [{ beat: 128, value: -0.3, curve: 'linear', tension: 0 }],
            })
        );
        expect(audioParamOf(entry, 1, 'gain').setValueAtTime).toHaveBeenCalledWith(dbToGain(-0.3), 0);
    });

    it('schedules a de-esser Range lane through the band-tap cancellation law', () => {
        const entry = webAudioEntry('device-1', 'builtin-deesser');
        scheduleDeviceLane(
            entry,
            makeLane({
                parameterId: 'device-1:deess-range',
                minValue: -30,
                maxValue: 0,
                points: [{ beat: 128, value: -12, curve: 'linear', tension: 0 }],
            })
        );
        const named = entry.node.namedNodes;
        if (!named) {
            throw new Error('expected named de-esser nodes');
        }
        const wet = (named.wet as GainNode).gain;
        const cancel = (named.cancel as GainNode).gain;
        expect(wet.setValueAtTime).toHaveBeenCalledWith(dbToGain(-12), 0);
        expect(cancel.setValueAtTime).toHaveBeenCalledWith(-dbToGain(-12), 0);
    });
});
