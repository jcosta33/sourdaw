import { resolveEligibleDeviceWriteTarget, trackStore } from '#/modules/Arrangement/stores';
import { getDeviceAutomationParameterId, resolveDeviceAutomationTargetIndex } from '#/utils/automationDeviceTarget';

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
type ModulationTrack = NonNullable<typeof trackStore.value>['tracks'][number];
type AutomationLane = NonNullable<typeof automationStore.value>['lanes'][number];

let indexedTracks: readonly ModulationTrack[] | undefined;
let indexedLanes: readonly AutomationLane[] | undefined;
const trackById = new Map<string, ModulationTrack>();
const automatedBaseByTrack = new Map<string, Map<string, Map<string, number>>>();
const automationVisited = new Set<string>();

function deviceAcceptsAutomationParameter(
    device: { parameterValues: Record<string, number> },
    parameterId: string
): boolean {
    return device.parameterValues[parameterId] !== undefined;
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

function refreshTrackIndex(): void {
    const tracks = trackStore.value?.tracks;
    if (tracks === indexedTracks) {
        return;
    }
    indexedTracks = tracks;
    trackById.clear();
    if (!tracks) {
        return;
    }
    for (const track of tracks) {
        trackById.set(track.id, track);
    }
}

function clearAutomatedBaseValues(): void {
    for (const baseByDevice of automatedBaseByTrack.values()) {
        for (const baseByParameter of baseByDevice.values()) {
            baseByParameter.clear();
        }
    }
}

function setAutomatedBase(trackId: string, deviceId: string, parameterId: string, value: number): void {
    let baseByDevice = automatedBaseByTrack.get(trackId);
    if (!baseByDevice) {
        baseByDevice = new Map<string, Map<string, number>>();
        automatedBaseByTrack.set(trackId, baseByDevice);
    }
    let baseByParameter = baseByDevice.get(deviceId);
    if (!baseByParameter) {
        baseByParameter = new Map<string, number>();
        baseByDevice.set(deviceId, baseByParameter);
    }
    baseByParameter.set(parameterId, value);
}

function getAutomatedBase(trackId: string, deviceId: string, parameterId: string): number | undefined {
    return automatedBaseByTrack.get(trackId)?.get(deviceId)?.get(parameterId);
}

function isClipActive(track: ModulationTrack, clipId: string, currentBeat: number): boolean {
    for (const clip of track.clips) {
        if (clip.id === clipId) {
            return currentBeat >= clip.startBeat && currentBeat <= clip.endBeat;
        }
    }
    return false;
}

function indexAutomatedBases(currentBeat: number): void {
    refreshTrackIndex();
    const autoState = automationStore.value;
    if (!autoState) {
        clearAutomatedBaseValues();
        return;
    }
    const lanes = autoState.lanes;
    if (lanes !== indexedLanes) {
        indexedLanes = lanes;
        automatedBaseByTrack.clear();
    } else {
        clearAutomatedBaseValues();
    }

    for (const lane of lanes) {
        const track = trackById.get(lane.trackId);
        if (
            !track ||
            track.automationMode === 'off' ||
            lane.points.length === 0 ||
            lane.parameterId === 'gain' ||
            lane.parameterId === 'pan'
        ) {
            continue;
        }
        if (lane.clipId && !isClipActive(track, lane.clipId, currentBeat)) {
            continue;
        }
        if (isRecordingAutomation(lane.trackId, lane.parameterId)) {
            continue;
        }
        const deviceIndex = resolveDeviceAutomationTargetIndex(
            lane.parameterId,
            track.devices,
            deviceAcceptsAutomationParameter
        );
        const laneParamId = getDeviceAutomationParameterId(lane.parameterId);
        const device = track.devices[deviceIndex];
        if (!device || !laneParamId) {
            continue;
        }
        automationVisited.clear();
        const value = getAutomationValueAtBeat(lane.id, currentBeat, automationVisited);
        if (value !== null) {
            // Match applyAutomation array ordering: later equivalent lanes win.
            setAutomatedBase(lane.trackId, device.id, laneParamId, value);
        }
    }
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
    let hasEnabledMapping = false;
    for (const modulator of state.modulators) {
        if (modulator.enabled && modulator.mappings.length > 0) {
            hasEnabledMapping = true;
            break;
        }
    }
    if (!hasEnabledMapping) {
        return;
    }
    indexAutomatedBases(currentBeat);

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
            const targetOwner = resolveEligibleDeviceWriteTarget(mapping.targetDeviceId);
            if (targetOwner.status !== 'eligible' || targetOwner.trackId !== mapping.targetTrackId) {
                continue;
            }

            const key = `${mapping.targetTrackId} ${mapping.targetDeviceId} ${mapping.targetParamId}`;
            const base =
                getAutomatedBase(mapping.targetTrackId, mapping.targetDeviceId, mapping.targetParamId) ??
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
            const hadPrev = modulationParamSlew.has(key);
            const prev = modulationParamSlew.get(key) ?? target;
            const smoothed = hadPrev ? prev + (target - prev) * SLEW_ALPHA : target;
            modulationParamSlew.set(key, smoothed);

            if (!hadPrev || Math.abs(smoothed - prev) > SLEW_EPSILON) {
                getModulationDependencies().updateDeviceParam(
                    targetOwner.trackId,
                    targetOwner.deviceId,
                    mapping.targetParamId,
                    smoothed
                );
            }
        }
    }
}
