import { describe, expect, it, vi } from 'vitest';

import {
    clampDeviceParameterValue,
    getBuiltinPlugins,
    isDeviceParameterAutomatable,
    quantiseDeviceParameterValue,
} from '#/modules/Arrangement/useCases';
import { automationSlewTickSecondsForGrain } from '#/utils/automationSlew';

import { FERMENTER_AUTOMATION_PARAM_IDS } from '../../../engine/FermenterNode';
import { type AutomationLane } from '../../../models/AutomationViewTypes';
import { NativeDspDeviceStrategy } from '../../deviceStrategy/NativeDspDeviceStrategy';
import { scheduleTrackAutomation } from '../automationScheduling';

import type { OfflineAutomationSegment } from '../../deviceStrategy/AudioDeviceStrategy';

/**
 * OE-3 / SPEC-parameter-automation-coverage: an automated Fermenter
 * `oscWaveform` lane must reach the offline render, not only the monitor.
 *
 * Live, the lane rides through `applyAutomation` → `quantiseDeviceParameterValue`
 * → `applyFermenterRuntimeParam` → `set_param('osc_waveform')`, and
 * `applyAutomationSteppedQuantisation.spec.ts` pins that it delivers a moving
 * integer stream. Offline, `scheduleTrackAutomation` asks the device strategy for
 * a binding; `NativeDspDeviceStrategy` answers only for names the node's own
 * `acceptsScheduledParam` admits, and `FERMENTER_AUTOMATION_PARAM_IDS` did not
 * carry `oscWaveform` — so the lane was dropped with a bare `continue` and the
 * bounce rendered whichever waveform the patch happened to start on.
 *
 * **What this asserts is the segment stream handed to the node, not audio.** It
 * proves the automation reached the device's scheduled-parameter port with a
 * moving value; it does not prove the rendered signal changed. The signal-level
 * null is SPEC AC-4 evidence 2 and is not obtainable in Vitest (no wasm device
 * fixture, no moving-lane fixture class).
 *
 * The ride is 0 → 3 and neither endpoint is the default. `oscWaveform` defaults
 * to **1** (`FermenterDescriptor.ts`), and `crates/daw-dsp/src/fermenter/layer.rs`
 * stores it as `(value as u8).min(3)` feeding `Voice::set_waveform` — 0 and 3 are
 * two different wavetables, so a guard parked at either the default or a single
 * index would be green over a parameter the engine never moved.
 */

const SLEW_TICK_SECONDS = automationSlewTickSecondsForGrain(10);
const DEVICE_ID = 'device-fermenter-1';

type ScheduledCall = { name: string; segments: readonly OfflineAutomationSegment[] };

function fermenterAutomatableParamIds(): string[] {
    const descriptor = getBuiltinPlugins().find((plugin) => plugin.id === 'fermenter');
    if (!descriptor) {
        throw new Error('expected a fermenter descriptor in the builtin plugin registry');
    }
    return descriptor.parameters.filter((param) => param.automatable).map((param) => param.id);
}

/**
 * The real strategy over a node carrying Fermenter's own production
 * `acceptsScheduledParam`/`scheduleParam` pair, imported rather than restated —
 * so the map under test is the shipped one.
 */
function makeFermenterStrategy(): { strategy: NativeDspDeviceStrategy; calls: ScheduledCall[] } {
    const calls: ScheduledCall[] = [];
    const strategy = new NativeDspDeviceStrategy({
        workletNode: {} as AudioWorkletNode,
        ready: Promise.resolve({}),
        acceptsScheduledParam: (name: string) => fermenterNodeAccepts(name),
        scheduleParam: vi.fn((name: string, segments: readonly OfflineAutomationSegment[]) => {
            calls.push({ name, segments });
        }),
    });
    return { strategy, calls };
}

/** Fermenter's shipped offline predicate, read off the node module. */
function fermenterNodeAccepts(name: string): boolean {
    return Object.hasOwn(FERMENTER_AUTOMATION_PARAM_IDS, name);
}

function laneFor(
    paramId: string,
    range: { minValue: number; maxValue: number },
    points: Array<{ beat: number; value: number }>
): AutomationLane {
    return {
        id: `lane-${paramId}`,
        trackId: 'track-1',
        parameterId: `${DEVICE_ID}:${paramId}`,
        parameterName: paramId,
        enabled: true,
        minValue: range.minValue,
        maxValue: range.maxValue,
        points: points.map((point) => ({ ...point, curve: 'linear' as const, tension: 0 })),
    };
}

function runOfflineSchedule(lanes: AutomationLane[]): ScheduledCall[] {
    const { strategy, calls } = makeFermenterStrategy();
    const automatable = new Set(fermenterAutomatableParamIds());
    scheduleTrackAutomation({
        lanes,
        trackId: 'track-1',
        trackGainNode: { gain: {} } as unknown as GainNode,
        trackPanNode: { pan: {} } as unknown as StereoPannerNode,
        deviceEntries: [{ deviceId: DEVICE_ID, deviceType: 'fermenter', strategy }],
        durationSeconds: 2,
        defaultTempo: 120,
        changes: [],
        slewTickSeconds: SLEW_TICK_SECONDS,
        sampleRate: 48_000,
        deviceParameterLaw: {
            // The live predicate: the device carries the key AND the descriptor
            // declares it automatable. Not `resolveOfflineAutomation() !== null`
            // — that conjunction would make the offline binding decide its own
            // eligibility and this spec could never distinguish "the device was
            // never selected" from "the device was selected and had no binding".
            acceptsAutomation: ({ deviceType, parameterId }) =>
                automatable.has(parameterId) && isDeviceParameterAutomatable({ deviceType, paramId: parameterId }),
            clampValue: clampDeviceParameterValue,
            quantiseValue: quantiseDeviceParameterValue,
        },
        // Every lane here rides a device parameter, so the gain-lane ceiling law
        // never runs; the declared range keeps this spec about the waveform
        // stream rather than about the fader's headroom.
        resolveLaneCeiling: (lane) => lane.maxValue,
    });
    return calls;
}

function valueStream(segments: readonly OfflineAutomationSegment[]): number[] {
    const values: number[] = [segments[0]!.startValue];
    for (const segment of segments) {
        if (values.at(-1) !== segment.endValue) {
            values.push(segment.endValue);
        }
    }
    return values;
}

describe('Fermenter oscWaveform automation in an offline render', () => {
    it('schedules an automated oscWaveform lane onto the device instead of dropping it', () => {
        const calls = runOfflineSchedule([
            laneFor('oscWaveform', { minValue: 0, maxValue: 3 }, [
                { beat: 0, value: 0 },
                { beat: 4, value: 3 },
            ]),
        ]);

        const waveform = calls.find((call) => call.name === 'oscWaveform');
        expect(waveform).toBeDefined();
        const stream = valueStream(waveform!.segments);
        // Arrives at the far index rather than stalling: a quantiser folded into
        // the slew's own feedback dead-zones at 2 and never reaches 3.
        expect(stream.at(0)).toBe(0);
        expect(stream.at(-1)).toBe(3);
        // Every emitted endpoint is an index the engine has. `layer.rs` stores
        // `(value as u8).min(3)`, so a fractional endpoint is a silent truncation
        // to a different waveform than the lane and the monitor both read.
        expect(stream.filter((value) => !Number.isInteger(value))).toEqual([]);
        // More than one index, so the ride is not parked on one state.
        expect(new Set(stream).size).toBeGreaterThan(1);
    });

    it('still schedules filterCutoff, so a dropped oscWaveform is the binding and not the harness', () => {
        // Presence pin for the assertion above. `filterCutoff` has carried an
        // offline binding since the map was introduced; if this went quiet the
        // first test's failure would say nothing about `oscWaveform`.
        const calls = runOfflineSchedule([
            laneFor('filterCutoff', { minValue: 20, maxValue: 20_000 }, [
                { beat: 0, value: 400 },
                { beat: 4, value: 8000 },
            ]),
        ]);

        const cutoff = calls.find((call) => call.name === 'filterCutoff');
        expect(cutoff).toBeDefined();
        const stream = valueStream(cutoff!.segments);
        expect(stream.at(0)).toBe(400);
        // The lane's last point sits on the region end, so the slew is still
        // gliding when the render stops; it approaches 8000 without reaching it.
        expect(stream.at(-1)).toBeGreaterThan(7900);
        expect(stream.at(-1)).toBeLessThanOrEqual(8000);
    });
});
