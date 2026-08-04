import { resolveEligibleDeviceWriteTarget, trackStore } from '#/modules/Arrangement/stores';
import { getDeviceAutomationParameterId, resolveDeviceAutomationTargetIndex } from '#/utils/automationDeviceTarget';

import { automationStore } from '../../stores/automationStore';
import { modulationStore } from '../../stores/modulationStore';
import { getAutomationValueAtBeat } from '../automation/getAutomationValueAtBeat';
import { isRecordingAutomationByKey } from '../automationRecording/isRecordingAutomationByKey';
import { makeKey } from '../automationRecording/makeKey';

import { computeModulatorValue } from './computeModulatorValue';
import { getModulationDependencies } from './getModulationDependencies';
import { modulationParamSlew, modulationSlewEpoch } from './modulationSlewState';
import { resolveModulationBinding } from './resolveModulationBinding';

const SLEW_ALPHA = 0.4;
const SLEW_EPSILON = 5e-5;
type ModulationTrack = NonNullable<typeof trackStore.value>['tracks'][number];
type AutomationLane = NonNullable<typeof automationStore.value>['lanes'][number];
type IndexedLane = readonly [AutomationLane, ModulationTrack, string, string, string];
type AutomatedBaseSlot = { activeLaneCount: number; value: number | null };
/**
 * What the live automation pass actually wrote to each device parameter
 * on this tick, indexed `deviceId → parameterId → value`. Nested rather than a
 * composite string key so no key format has to be agreed across modules. The
 * transport scheduler owns the map and hands it in; it is read-only here.
 */
type AppliedAutomationBases = ReadonlyMap<string, ReadonlyMap<string, number>>;

const trackById = new Map<string, ModulationTrack>();
let cachedLanesRef: readonly AutomationLane[] | undefined;
let cachedTracksRef: readonly ModulationTrack[] | undefined;
const cachedDeviceRefs: ModulationTrack['devices'][] = [];
const indexedLaneMetadata: IndexedLane[] = [];
const automatedBaseByDevice = new Map<string, Map<string, AutomatedBaseSlot>>();
const automatedBaseSlots: AutomatedBaseSlot[] = [];
const automationVisited = new Set<string>();

/**
 * Same acceptance law as the Transport apply path. Reached through the DI port
 * rather than by importing Arrangement's use cases directly, because that edge
 * is the static cycle this seam exists to break. A device that declares nothing
 * is unconstrained, as before.
 */
function deviceAcceptsAutomationParameter(
    device: { type: string; parameterValues: Record<string, number> },
    parameterId: string
): boolean {
    if (device.parameterValues[parameterId] === undefined) {
        return false;
    }

    const declared = getModulationDependencies().getPluginParamRange(device.type, parameterId);
    if (!declared) {
        return true;
    }

    return declared.automatable;
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
    for (let index = 0; index < automatedBaseSlots.length; index++) {
        const slot = automatedBaseSlots[index]!;
        slot.activeLaneCount = 0;
        slot.value = null;
    }
}

function setAutomatedBase(deviceId: string, parameterId: string, value: number): void {
    let baseByParameter = automatedBaseByDevice.get(deviceId);
    if (!baseByParameter) {
        baseByParameter = new Map<string, AutomatedBaseSlot>();
        automatedBaseByDevice.set(deviceId, baseByParameter);
    }
    let slot = baseByParameter.get(parameterId);
    if (!slot) {
        slot = { activeLaneCount: 0, value: null };
        baseByParameter.set(parameterId, slot);
        automatedBaseSlots.push(slot);
    }
    slot.activeLaneCount += 1;
    slot.value = value;
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
    automatedBaseSlots.length = 0;
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
 *
 * On a transport discontinuity (a change in the scheduler discontinuity epoch
 * passed in) the slew is snapped straight to the combined target on the first
 * tick — the modulation analog of `applyAutomation`'s slew reset.
 */
export function applyModulationToEngine(
    currentBeat: number,
    discontinuityEpoch?: number,
    appliedAutomationBases?: AppliedAutomationBases
): void {
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

    // Snap every modulated target on the first tick after a transport
    // discontinuity (seek, loop-wrap, follow-action jump) instead of gliding
    // ~90ms from the pre-jump smoothed value. The scheduler passes its
    // discontinuity epoch; a change means a jump.
    const isDiscontinuity =
        discontinuityEpoch !== undefined &&
        modulationSlewEpoch.last !== undefined &&
        discontinuityEpoch !== modulationSlewEpoch.last;
    if (discontinuityEpoch !== undefined) {
        modulationSlewEpoch.last = discontinuityEpoch;
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
            const automatedBase = automatedBaseByDevice.get(mapping.targetDeviceId)?.get(mapping.targetParamId);
            // Prefer the value applyAutomation actually applied to this
            // param on this tick — the *slewed* one. Recomputing the raw curve
            // value here made the two writers disagree about the same param in
            // the same tick: automation wrote the slewed value, then modulation
            // overwrote it with raw + delta, so the combined value jumped ahead
            // of the glide automation alone would have produced. Falls back to
            // the raw indexed base (no automation write this tick, e.g. the lane
            // is being recorded or is gated off) and then to the persisted base.
            const appliedBase = appliedAutomationBases?.get(mapping.targetDeviceId)?.get(mapping.targetParamId);
            const base = appliedBase ?? automatedBase?.value ?? binding.baseValue;
            // applyAutomation may have just written an earlier equivalent lane;
            // restate the later authoritative combined target after that write.
            const hasCompetingAutomationWrites = (automatedBase?.activeLaneCount ?? 0) > 1;

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
            const smoothed = hadPrev && !isDiscontinuity ? prev + (target - prev) * SLEW_ALPHA : target;
            // The slew state stays continuous for the same reason the automation
            // applier's does: rounding the value the filter feeds itself puts a
            // dead zone in the recurrence (α = 0.4, `5 + 0.4·1` = 5.4 rounds
            // straight back to 5), so a modulation that should carry the index
            // one step would never arrive. Quantise the delivery, not the state.
            modulationParamSlew.set(key, smoothed);
            const delivered = getModulationDependencies().quantiseValue({
                deviceType: binding.deviceType,
                paramId: mapping.targetParamId,
                value: smoothed,
            });
            const previousDelivered = getModulationDependencies().quantiseValue({
                deviceType: binding.deviceType,
                paramId: mapping.targetParamId,
                value: prev,
            });

            // The epsilon gate reads on the delivered domain for the same reason
            // `applyAutomation`'s does: a stepped parameter's filter keeps moving
            // long after the delivered index has stopped changing, so the
            // continuous gate alone re-sends an identical index every tick. The
            // three unconditional terms are unchanged — a first tick, a
            // transport discontinuity and a competing automation write each have
            // to reach the engine whether or not the value moved. For a `float`
            // parameter `delivered === smoothed`, so nothing changes there.
            const movedPastEpsilon = Math.abs(smoothed - prev) > SLEW_EPSILON && delivered !== previousDelivered;

            if (!hadPrev || isDiscontinuity || movedPastEpsilon || hasCompetingAutomationWrites) {
                getModulationDependencies().updateDeviceParam(
                    targetOwner.trackId,
                    targetOwner.deviceId,
                    mapping.targetParamId,
                    delivered
                );
            }
        }
    }
}
