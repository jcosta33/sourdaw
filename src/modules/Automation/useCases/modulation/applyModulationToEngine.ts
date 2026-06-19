import { trackStore } from '#/modules/Arrangement/stores';

import { type ModulatorMapping } from '../../models/Modulator';
import { automationStore } from '../../stores/automationStore';
import { modulationStore } from '../../stores/modulationStore';
import { getAutomationValueAtBeat } from '../automation/getAutomationValueAtBeat';
import { isRecordingAutomation } from '../automationRecording/isRecordingAutomation';

import { computeModulatorValue } from './computeModulatorValue';
import { getModulationDependencies } from './modulationDependencies';

/**
 * Per-(track,device,param) exponential slew state for the modulation→engine
 * write, mirroring `applyAutomation`'s slew so the modulation path produces the
 * same smooth ramps instead of stepping the param every tick (zipper noise).
 */
const SLEW_ALPHA = 0.4;
const SLEW_EPSILON = 5e-5;
const modulationParamSlew = new Map<string, number>();

/**
 * Clears all per-param slew state. The slew map is module-level (it must survive
 * across scheduler ticks to ramp smoothly), so a test exercising the slew path
 * must reset it between cases or a prior case's seeded value leaks in and
 * suppresses the next write. Not used on the runtime hot path.
 */
export function resetModulationSlew(): void {
    modulationParamSlew.clear();
}

type MappingBinding = {
    baseValue: number;
    paramMin: number;
    paramMax: number;
};

function resolveBinding(mapping: ModulatorMapping): MappingBinding | null {
    const tracks = trackStore.value?.tracks;
    if (!tracks) {
        return null;
    }
    const track = tracks.find((candidate) => candidate.id === mapping.targetTrackId);
    if (!track) {
        return null;
    }
    const device = track.devices.find((candidate) => candidate.id === mapping.targetDeviceId);
    if (!device) {
        return null;
    }
    const paramDef = getModulationDependencies().getPluginParamRange(device.type, mapping.targetParamId);
    if (!paramDef) {
        return null;
    }
    return {
        baseValue: device.parameterValues[mapping.targetParamId] ?? paramDef.defaultValue,
        paramMin: paramDef.min,
        paramMax: paramDef.max,
    };
}

function clamp(value: number, min: number, max: number): number {
    if (value < min) {
        return min;
    }
    if (value > max) {
        return max;
    }
    return value;
}

/**
 * Write each mapping's persisted base value back to the engine once.
 *
 * The engine only ever sees modulated overrides (`applyModulationToEngine`
 * writes every tick while a mapping is live); removing the modulator or the
 * mapping simply stops the writes, which leaves the engine param frozen at the
 * last modulated value. This restores the persisted base so removal actually
 * "lets go" of the param. Called on removal paths, not on the scheduler hot
 * path. De-duplicates by destination so the same param is reverted once even if
 * several removed mappings target it.
 */
export function revertMappingsToBase(mappings: readonly ModulatorMapping[]): void {
    // If the engine seam has not been wired (e.g. before app bootstrap, or in a
    // unit test that never calls `setModulationDependencies`), there is no engine
    // to revert and nothing was ever written — removal is then a pure store edit.
    let deps: ReturnType<typeof getModulationDependencies>;
    try {
        deps = getModulationDependencies();
    } catch {
        return;
    }

    const reverted = new Set<string>();
    for (const mapping of mappings) {
        const key = `${mapping.targetTrackId} ${mapping.targetDeviceId} ${mapping.targetParamId}`;
        if (reverted.has(key)) {
            continue;
        }
        const binding = resolveBinding(mapping);
        if (!binding) {
            continue;
        }
        reverted.add(key);
        // Drop the slew slot so a future re-add of this destination seeds fresh
        // at its new target rather than ramping from this now-stale value.
        modulationParamSlew.delete(key);
        deps.updateDeviceParam(mapping.targetTrackId, mapping.targetDeviceId, mapping.targetParamId, binding.baseValue);
    }
}

/**
 * The value automation is driving a `(trackId, parameterId)` to at `currentBeat`,
 * or `null` when automation is not authoritative for that param this tick. Used
 * as the base the modulation delta rides on top of, so a param that is BOTH
 * automated and modulated combines the two instead of the scheduler's later
 * modulation write clobbering the earlier automation write (last-write-wins).
 *
 * Mirrors `applyAutomation`'s lane guards: the track must exist and not be in
 * `automationMode === 'off'`, a clip-scoped lane only applies inside its clip,
 * and a lane being recorded into is skipped (the user is writing it live).
 */
function automatedBaseFor(trackId: string, parameterId: string, currentBeat: number): number | null {
    const autoState = automationStore.value;
    if (!autoState) {
        return null;
    }
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === trackId);
    if (!track || track.automationMode === 'off') {
        return null;
    }

    for (const lane of autoState.lanes) {
        if (lane.trackId !== trackId || lane.parameterId !== parameterId || lane.points.length === 0) {
            continue;
        }
        if (lane.clipId) {
            const clip = track.clips.find((candidate) => candidate.id === lane.clipId);
            if (!clip || currentBeat < clip.startBeat || currentBeat > clip.endBeat) {
                continue;
            }
        }
        if (isRecordingAutomation(trackId, parameterId)) {
            continue;
        }
        const value = getAutomationValueAtBeat(lane.id, currentBeat);
        if (value !== null) {
            return value;
        }
    }
    return null;
}

/**
 * Writes the current modulated value for every active mapping to the audio
 * engine. The persisted base in `trackStore` is never touched — modulation is
 * purely an engine-side override. Intended to be called once per scheduler
 * tick; combine with `applyModulation` so the visual halo and the engine see
 * consistent values.
 *
 * For a param that is also automated, the modulation delta is added on top of
 * the automated value (not the persisted base), so the two combine. Each write
 * is exponentially slewed per param to avoid zipper noise, matching
 * `applyAutomation`'s slew.
 */
export function applyModulationToEngine(currentBeat: number): void {
    const state = modulationStore.value;
    if (!state || state.modulators.length === 0) {
        return;
    }

    for (const modulator of state.modulators) {
        if (!modulator.enabled || modulator.mappings.length === 0) {
            continue;
        }
        const modValue = computeModulatorValue(modulator, currentBeat);

        for (const mapping of modulator.mappings) {
            const binding = resolveBinding(mapping);
            if (!binding) {
                continue;
            }

            // Combine: ride modulation on top of automation when the param is
            // automated this tick; otherwise on top of the persisted base.
            const base =
                automatedBaseFor(mapping.targetTrackId, mapping.targetParamId, currentBeat) ?? binding.baseValue;

            const paramRange = binding.paramMax - binding.paramMin;
            const delta = modValue * mapping.amount * paramRange;
            const target = clamp(base + delta, binding.paramMin, binding.paramMax);

            // Per-param exponential slew. On the first tick for a param the slot
            // is empty: seed it at the target and write immediately (so the
            // engine adopts the combined value without a one-tick ramp from a
            // stale slot). On later ticks, ramp toward the target and write only
            // when the value moved more than epsilon — suppressing sub-epsilon
            // jitter and zipper noise.
            const key = `${mapping.targetTrackId} ${mapping.targetDeviceId} ${mapping.targetParamId}`;
            const hadPrev = modulationParamSlew.has(key);
            const prev = modulationParamSlew.get(key) ?? target;
            const smoothed = hadPrev ? prev + (target - prev) * SLEW_ALPHA : target;
            modulationParamSlew.set(key, smoothed);

            if (!hadPrev || Math.abs(smoothed - prev) > SLEW_EPSILON) {
                getModulationDependencies().updateDeviceParam(
                    mapping.targetTrackId,
                    mapping.targetDeviceId,
                    mapping.targetParamId,
                    smoothed
                );
            }
        }
    }
}
