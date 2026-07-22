import { resolveEligibleDeviceWriteTarget, trackStore } from '#/modules/Arrangement/stores';
import { getDeviceAutomationParameterId, resolveDeviceAutomationTargetIndex } from '#/utils/automationDeviceTarget';

import { automationStore } from '../../stores/automationStore';
import { modulationStore } from '../../stores/modulationStore';
import { getAutomationValueAtBeat } from '../automation/getAutomationValueAtBeat';
import { isRecordingAutomationByKey } from '../automationRecording/isRecordingAutomationByKey';
import { makeKey } from '../automationRecording/makeKey';

import { computeModulatorValue } from './computeModulatorValue';
import { getModulationDependencies } from './getModulationDependencies';
import { modulationParamSlew } from './modulationSlewState';
import { resolveModulationBinding } from './resolveModulationBinding';

const SLEW_ALPHA = 0.4;
const SLEW_EPSILON = 5e-5;
type ModulationTrack = NonNullable<typeof trackStore.value>['tracks'][number];
type AutomationLane = NonNullable<typeof automationStore.value>['lanes'][number];
type IndexedLane = readonly [AutomationLane, ModulationTrack, string, string, string];

const trackById = new Map<string, ModulationTrack>();
let cachedLanesRef: readonly AutomationLane[] | undefined;
let cachedTracksRef: readonly ModulationTrack[] | undefined;
const cachedDeviceRefs: ModulationTrack['devices'][] = [];
const indexedLaneMetadata: IndexedLane[] = [];
const automatedBaseByDevice = new Map<string, Map<string, number>>();
const automatedBaseLeaves: Map<string, number>[] = [];
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

function clearAutomatedBaseValues(): void {
    for (let index = 0; index < automatedBaseLeaves.length; index++) {
        automatedBaseLeaves[index]!.clear();
    }
}

function setAutomatedBase(deviceId: string, parameterId: string, value: number): void {
    let baseByParameter = automatedBaseByDevice.get(deviceId);
    if (!baseByParameter) {
        baseByParameter = new Map<string, number>();
        automatedBaseByDevice.set(deviceId, baseByParameter);
        automatedBaseLeaves.push(baseByParameter);
    }
    baseByParameter.set(parameterId, value);
}

function isClipActive(track: ModulationTrack, clipId: string, currentBeat: number): boolean {
    for (const clip of track.clips) {
        if (clip.id === clipId) {
            return currentBeat >= clip.startBeat && currentBeat <= clip.endBeat;
        }
    }
    return false;
}

function laneMetadataChanged(lanes: readonly AutomationLane[], tracks: readonly ModulationTrack[]): boolean {
    if (lanes !== cachedLanesRef || tracks !== cachedTracksRef || tracks.length !== cachedDeviceRefs.length) {
        return true;
    }
    for (let index = 0; index < tracks.length; index++) {
        if (tracks[index]!.devices !== cachedDeviceRefs[index]) {
            return true;
        }
    }
    return false;
}

function rebuildLaneMetadata(lanes: readonly AutomationLane[], tracks: readonly ModulationTrack[]): void {
    cachedLanesRef = lanes;
    cachedTracksRef = tracks;
    trackById.clear();
    cachedDeviceRefs.length = tracks.length;
    for (let index = 0; index < tracks.length; index++) {
        const track = tracks[index]!;
        cachedDeviceRefs[index] = track.devices;
        trackById.set(track.id, track);
    }
    indexedLaneMetadata.length = 0;
    for (let index = 0; index < lanes.length; index++) {
        const lane = lanes[index]!;
        const track = trackById.get(lane.trackId);
        if (!track || track.automationMode === 'off' || lane.parameterId === 'gain' || lane.parameterId === 'pan') {
            continue;
        }
        const deviceIndex = resolveDeviceAutomationTargetIndex(
            lane.parameterId,
            track.devices,
            deviceAcceptsAutomationParameter
        );
        const parameterId = getDeviceAutomationParameterId(lane.parameterId);
        const device = track.devices[deviceIndex];
        if (device && parameterId) {
            indexedLaneMetadata.push([lane, track, device.id, parameterId, makeKey(lane.trackId, lane.parameterId)]);
        }
    }
    automatedBaseByDevice.clear();
    automatedBaseLeaves.length = 0;
}

function indexAutomatedBases(currentBeat: number): void {
    const autoState = automationStore.value;
    const tracks = trackStore.value?.tracks;
    if (!autoState || !tracks) {
        clearAutomatedBaseValues();
        return;
    }
    const lanes = autoState.lanes;
    if (laneMetadataChanged(lanes, tracks)) {
        rebuildLaneMetadata(lanes, tracks);
    }
    clearAutomatedBaseValues();

    for (let index = 0; index < indexedLaneMetadata.length; index++) {
        const [lane, track, deviceId, parameterId, recordingKey] = indexedLaneMetadata[index]!;
        if (lane.points.length === 0) {
            continue;
        }
        if (lane.clipId && !isClipActive(track, lane.clipId, currentBeat)) {
            continue;
        }
        if (isRecordingAutomationByKey(recordingKey, track.automationMode)) {
            continue;
        }
        automationVisited.clear();
        const value = getAutomationValueAtBeat(lane.id, currentBeat, automationVisited);
        if (value !== null) {
            // Match applyAutomation array ordering: later equivalent lanes win.
            setAutomatedBase(deviceId, parameterId, value);
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
                automatedBaseByDevice.get(mapping.targetDeviceId)?.get(mapping.targetParamId) ?? binding.baseValue;

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
