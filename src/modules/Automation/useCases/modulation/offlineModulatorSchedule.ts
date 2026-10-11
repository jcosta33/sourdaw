import { type Modulator } from '../../models/Modulator';
import { modulationStore } from '../../stores/modulationStore';

import { computeModulatorValue } from './computeModulatorValue';
import { dependencies } from './modulationDependencies';

/**
 * The offline evaluation of the modulator rack — the render-side half of live
 * playback's `applyModulationToEngine`.
 *
 * Live writes every enabled mapping once per scheduler tick: the curve
 * (`computeModulatorValue`) times the mapping amount times the parameter's
 * declared range is added on top of the value automation just applied, clamped
 * to the declared range, and written to the device. An offline render has no
 * ticks, so this module resolves each mapping once, into a plain plan the
 * offline scheduler can sample per scheduling block:
 *
 * - the binding facts live resolves through `resolveModulationBinding`
 *   (declared range, automatable flag, persisted base), read here from the
 *   same DI seam `applyModulationToEngine` reads;
 * - the delta as a pure function of the project beat, which is the exact
 *   expression live evaluates per tick (`computeModulatorValue(modulator,
 *   beat) × amount × (max − min)`).
 *
 * Composing the delta onto the parameter's base — the lane automation's
 * applied value when a lane drives the parameter, the persisted base when
 * nothing does — is the offline scheduler's job, in live's base-then-modulation
 * order.
 */
export type OfflineModulatorParamPlan = {
    /** The track the mapped device lives on — how callers filter per scheduling pass. */
    targetTrackId: string;
    deviceId: string;
    parameterId: string;
    deviceType: string;
    /** The persisted device value — live's `binding.baseValue` fallback. */
    baseValue: number;
    paramMin: number;
    paramMax: number;
    /** The live delta at a project beat, in device units: curve × amount × (max − min). */
    deltaAtBeat: (beat: number) => number;
};

type PlanTargetTrack = {
    id: string;
    devices: ReadonlyArray<{ id: string; type: string; parameterValues: Record<string, number> }>;
};

/**
 * Resolve every enabled mapping into a plan, keyed by nothing — callers filter
 * by `targetTrackId` (`scheduleTrackClips` schedules one track at a time).
 * A mapping that cannot resolve — its device is gone, or the parameter declares
 * no automatable range — is dropped, matching live's `resolveModulationBinding`
 * refusal to write a parameter that never passed the picker's law.
 *
 * The modulation dependencies are registered once at app init; when they are
 * absent no range law exists to decide whether a parameter may be modulated,
 * so no plans are produced rather than assuming a looser rule than live's.
 */
export function buildOfflineModulatorPlans(input: {
    tracks: readonly PlanTargetTrack[];
    modulators?: readonly Modulator[];
}): OfflineModulatorParamPlan[] {
    if (dependencies === null) {
        return [];
    }
    const { getPluginParamRange } = dependencies;
    const modulators = input.modulators ?? modulationStore.value?.modulators ?? [];
    const trackById = new Map(input.tracks.map((track) => [track.id, track]));
    const plans: OfflineModulatorParamPlan[] = [];

    for (const modulator of modulators) {
        if (!modulator.enabled || modulator.mappings.length === 0) {
            continue;
        }
        for (const mapping of modulator.mappings) {
            const track = trackById.get(mapping.targetTrackId);
            const device = track?.devices.find((candidate) => candidate.id === mapping.targetDeviceId);
            if (!track || !device) {
                continue;
            }
            const range = getPluginParamRange(device.type, mapping.targetParamId);
            if (!range || !range.automatable) {
                continue;
            }
            const paramSpan = range.max - range.min;
            plans.push({
                targetTrackId: track.id,
                deviceId: device.id,
                parameterId: mapping.targetParamId,
                deviceType: device.type,
                baseValue: device.parameterValues[mapping.targetParamId] ?? range.defaultValue,
                paramMin: range.min,
                paramMax: range.max,
                deltaAtBeat: (beat: number) => computeModulatorValue(modulator, beat) * mapping.amount * paramSpan,
            });
        }
    }
    return plans;
}
