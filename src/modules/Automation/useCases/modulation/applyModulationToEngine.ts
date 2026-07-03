import { trackStore } from '#/modules/Arrangement/stores';

import { automationStore } from '../../stores/automationStore';
import { modulationStore } from '../../stores/modulationStore';
import { getAutomationValueAtBeat } from '../automation/getAutomationValueAtBeat';
import { isRecordingAutomation } from '../automationRecording/isRecordingAutomation';

import { computeModulatorValue } from './computeModulatorValue';
import { getModulationDependencies } from './getModulationDependencies';
import { modulationParamSlew } from './modulationSlewState';
import { resolveModulationBinding } from './resolveModulationBinding';

const SLEW_ALPHA = 0.4;
const SLEW_EPSILON = 5e-5;

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
 * The value automation is driving the modulation's target device-param to at
 * `currentBeat`, or `null` when automation is not authoritative this tick. Used
 * as the base the modulation delta rides on top of, so a param that is BOTH
 * automated and modulated combines the two instead of the scheduler's later
 * modulation write clobbering the earlier automation write (last-write-wins).
 *
 * The lane it matches must be the *device-param* lane that writes to this exact
 * param: device-param lanes carry a prefixed `${deviceType}:${paramId}`
 * parameterId (Workspace/.../automationViewHelpers.ts), and `applyAutomation`
 * forwards their value verbatim to `updateDeviceParam` — the same engine space
 * the modulation write targets. A *track-level* `gain`/`pan` lane carries the
 * bare id and is converted (dB→linear, pan remap) before a *track* engine
 * setter; it must NOT be matched here, or a normalized track-gain value would
 * ride a device-param modulation in the wrong units.
 *
 * Mirrors `applyAutomation`'s lane guards: the track must exist and not be in
 * `automationMode === 'off'`, a clip-scoped lane only applies inside its clip,
 * and a lane being recorded into is skipped (the user is writing it live).
 */
function automatedBaseFor(trackId: string, deviceType: string, paramId: string, currentBeat: number): number | null {
    const autoState = automationStore.value;
    if (!autoState) {
        return null;
    }
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === trackId);
    if (!track || track.automationMode === 'off') {
        return null;
    }

    const deviceLaneParameterId = `${deviceType}:${paramId}`;
    for (const lane of autoState.lanes) {
        if (lane.trackId !== trackId || lane.parameterId !== deviceLaneParameterId || lane.points.length === 0) {
            continue;
        }
        if (lane.clipId) {
            const clip = track.clips.find((candidate) => candidate.id === lane.clipId);
            if (!clip || currentBeat < clip.startBeat || currentBeat > clip.endBeat) {
                continue;
            }
        }
        if (isRecordingAutomation(trackId, lane.parameterId)) {
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
            const binding = resolveModulationBinding(mapping);
            if (!binding) {
                continue;
            }

            // Combine: ride modulation on top of automation when the param is
            // automated this tick; otherwise on top of the persisted base. The
            // automated base is read from the device-param lane (binding.deviceType),
            // so it is already in this param's engine space.
            const base =
                automatedBaseFor(mapping.targetTrackId, binding.deviceType, mapping.targetParamId, currentBeat) ??
                binding.baseValue;

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
