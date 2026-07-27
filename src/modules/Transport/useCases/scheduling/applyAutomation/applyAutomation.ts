import { getTrackEligibility, resolveEligibleDeviceWriteTarget, trackStore } from '#/modules/Arrangement/stores';
import { getEffectiveGain } from '#/modules/Arrangement/useCases';
import {
    getCompensationDelay,
    getCurrentTime,
    scheduleTrackGain,
    scheduleTrackPan,
    updateDeviceParam,
    updateMidiFxParam,
} from '#/modules/AudioEngine/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { getAutomationValueAtBeat, isRecordingAutomation, resolveAutoMatchValue } from '#/modules/Automation/useCases';
import { updateFermenterMappedParamInEngine } from '#/modules/Fermenter/useCases';
import { dbToGain } from '#/utils/audioLevelLaw';
import {
    getDeviceAutomationParameterId,
    resolveDeviceAutomationTargetIndex,
    UNRESOLVED_DEVICE_AUTOMATION_TARGET,
} from '#/utils/automationDeviceTarget';
import { AUTOMATION_SLEW_ALPHA, slewStep } from '#/utils/automationSlew';

import { schedulerSession } from '../../playheadScheduler/schedulerSession';

import { appliedAutomationBases, clearAppliedAutomationBases } from './appliedAutomationBases';
import { restoreAutomationBaseValue } from './restoreAutomationBaseValue';

/**
 * Per-parameter exponential slew state for plugin automation. The IIR
 * coefficient (AUTOMATION_SLEW_ALPHA, 0.4) and its one-tick step (slewStep) are
 * the shared #/utils/automationSlew kernel the offline render replicates for
 * device-param parity (AU-2). ~95% of target reached in ~9 ticks (~90ms at
 * 100Hz). Do not re-inline the coefficient here.
 */
/** Skip dispatch when the smoothed value has moved less than this per tick. */
const SLEW_EPSILON = 5e-5;

function deviceAcceptsAutomationParameter(
    device: { parameterValues: Record<string, number> },
    parameterId: string
): boolean {
    return device.parameterValues[parameterId] !== undefined;
}

const automationState: {
    pluginParamSlew: Map<string, Map<string, number>>;
    trackIndex: Map<string, NonNullable<typeof trackStore.value>['tracks'][number]>;
    /**
     * The scheduler discontinuity epoch observed on the previous tick. When it
     * advances (seek, loop-wrap, follow-action jump) the next apply snaps every
     * plugin-param slew to its target instead of gliding from the pre-jump value.
     */
    lastDiscontinuityEpoch: number | undefined;
    /**
     * Lane ids that wrote their parameter on the previous tick. The
     * driving → not-driving edge is what triggers the one-shot restore of the
     * manual base; without it a gated lane would either strand the parameter or
     * fight the UI by rewriting the base every tick.
     */
    drivingLanes: Set<string>;
} = {
    pluginParamSlew: new Map<string, Map<string, number>>(),
    trackIndex: new Map<string, NonNullable<typeof trackStore.value>['tracks'][number]>(),
    lastDiscontinuityEpoch: undefined,
    drivingLanes: new Set<string>(),
};

export function applyAutomation(currentBeat: number): Set<string> {
    // Track ids whose fader gain this tick's automation composed and wrote.
    // applyVcaGains skips these so the VCA writer defers to the composed value
    // instead of racing it (see the gain branch below).
    const gainAutomationTrackIds = new Set<string>();
    // This tick's device writes, handed to applyModulationToEngine so a
    // param that is both automated and modulated combines onto the value
    // automation actually applied rather than a separately recomputed one.
    clearAppliedAutomationBases();
    const autoState = automationStore.value;
    if (!autoState) {
        return gainAutomationTrackIds;
    }

    // A transport discontinuity (seek, loop-wrap, follow-action jump) advances
    // the scheduler's discontinuity epoch. On the first apply after it changes,
    // snap the plugin-param slew straight to the target — a jump is a jump —
    // rather than easing ~90ms from the now-stale pre-jump smoothed value.
    const currentEpoch = schedulerSession.discontinuityEpoch;
    const isDiscontinuity =
        automationState.lastDiscontinuityEpoch !== undefined && currentEpoch !== automationState.lastDiscontinuityEpoch;
    automationState.lastDiscontinuityEpoch = currentEpoch;

    // RT-5: gain/pan automation must land on the same PDC-delayed clock as the
    // clips it shapes. Read the engine clock once per tick and memoize each
    // track's compensation so every lane schedules at `now + compensation`.
    const now = getCurrentTime();
    const compensationByTrack = new Map<string, number>();
    const compensationFor = (trackId: string): number => {
        const cached = compensationByTrack.get(trackId);
        if (cached !== undefined) {
            return cached;
        }
        const compensation = getCompensationDelay(trackId);
        compensationByTrack.set(trackId, compensation);
        return compensation;
    };

    const tracks = trackStore.value?.tracks;

    automationState.trackIndex.clear();
    if (tracks) {
        for (const time of tracks) {
            automationState.trackIndex.set(time.id, time);
        }
    }

    for (const lane of autoState.lanes) {
        if (lane.points.length === 0) {
            continue;
        }

        const track = automationState.trackIndex.get(lane.trackId);
        if (!track) {
            automationState.drivingLanes.delete(lane.id);
            continue;
        }

        // Two gates stop a lane driving without the project's own
        // value changing: the track's automationMode going to 'off', and the
        // lane being marked disabled. `enabled` is compared against `false`
        // rather than falsy so a lane persisted before the flag existed (which
        // the legacy normalizer resolves to `enabled: true`) still plays.
        //
        // Skipping alone only stops *writing*: the engine holds whatever the
        // ride last pushed, stranding the parameter mid-ride. On the tick a lane
        // that was driving becomes gated, restore its manual base once and drop
        // its slew state so a later re-engage seeds cleanly instead of gliding
        // from a stale smoothed value.
        if (track.automationMode === 'off' || lane.enabled === false) {
            if (automationState.drivingLanes.delete(lane.id)) {
                automationState.pluginParamSlew.delete(lane.id);
                restoreAutomationBaseValue({
                    lane,
                    track,
                    landTime: now + compensationFor(lane.trackId),
                });
            }
            continue;
        }

        if (lane.clipId) {
            const clip = track.clips.find((context) => context.id === lane.clipId);
            if (!clip || currentBeat < clip.startBeat || currentBeat > clip.endBeat) {
                continue;
            }
        }

        if (isRecordingAutomation(lane.trackId, lane.parameterId)) {
            continue;
        }

        const curveValue = getAutomationValueAtBeat(lane.id, currentBeat);
        if (curveValue === null) {
            continue;
        }

        // A control released from a touch/latch ride glides back to the
        // curve over the AutoMatch time instead of being handed straight back to
        // it. With no pending release this returns the curve value unchanged.
        const autoMatch = resolveAutoMatchValue({
            trackId: lane.trackId,
            parameterId: lane.parameterId,
            automationValue: curveValue,
            nowSeconds: now,
        });
        const value = autoMatch.value;
        if (autoMatch.isReleaseStart) {
            // The lane was skipped for the whole ride, so its slew still holds a
            // stale pre-ride value. Drop it so the glide seeds at the released
            // value rather than easing toward it from wherever the parameter sat
            // before the user touched it.
            automationState.pluginParamSlew.delete(lane.id);
        }

        // From here the lane writes its parameter, so it is driving: the gate
        // above will restore this lane's manual base on the tick it stops.
        automationState.drivingLanes.add(lane.id);

        // RT-5 param-family split. `gain` and `pan` are the only automation
        // targets backed by a real native AudioParam (fader GainNode.gain /
        // StereoPannerNode.pan), so they adopt sample-accurate, PDC-aligned
        // scheduling: the value lands at `getCurrentTime() +
        // getCompensationDelay(track)` — the same delayed clock scheduleAudioClips
        // places the compensated audio on — and ramps a-rate instead of stepping
        // at the tick grid. Device params (below) and MIDI-FX params reach their
        // DSP through worklet MessagePort writes (updateDeviceParam /
        // updateFermenterMappedParamInEngine / updateMidiFxParam), which apply on the next
        // render block and cannot be JS-scheduled a-rate here — they keep the
        // tick-grid apply + exponential slew (with the #746 discontinuity snap).
        // Offline export already schedules every family a-rate
        // (scheduleAutomationOnParam); this closes the live half for the
        // AudioParam-backed families only.
        if (lane.parameterId === 'gain') {
            // One shared level law. A lane with `minValue < 0` is a
            // decibel lane; `dbToGain` is the same conversion the offline
            // scheduler now applies, so the bounce matches the monitor.
            const linearGain = lane.minValue < 0 ? dbToGain(value) : value;
            // Compose the VCA master multiplier so a gain lane on a VCA-member
            // track scales WITH its group rather than nullifying it. getEffectiveGain
            // with a base of 1 returns just the multiplier (1 for a non-VCA track).
            // The track id is recorded so applyVcaGains skips its own write for it —
            // the two writers compose instead of competing (our cancelScheduledValues
            // would otherwise erase applyVcaGains' setTargetAtTime every tick).
            const vcaMultiplier = getEffectiveGain(lane.trackId, 1);
            scheduleTrackGain(lane.trackId, linearGain * vcaMultiplier, now + compensationFor(lane.trackId));
            gainAutomationTrackIds.add(lane.trackId);
        } else if (lane.parameterId === 'pan') {
            scheduleTrackPan(lane.trackId, value * 50, now + compensationFor(lane.trackId));
        } else {
            let laneSlew = automationState.pluginParamSlew.get(lane.id);

            const deviceIndex = resolveDeviceAutomationTargetIndex(
                lane.parameterId,
                track.devices,
                deviceAcceptsAutomationParameter
            );

            if (deviceIndex >= 0) {
                const device = track.devices[deviceIndex]!;
                const paramId = getDeviceAutomationParameterId(lane.parameterId);
                if (!paramId) {
                    continue;
                }
                const targetOwner = resolveEligibleDeviceWriteTarget(device.id);
                if (targetOwner.status !== 'eligible' || targetOwner.trackId !== lane.trackId) {
                    continue;
                }
                if (!laneSlew) {
                    laneSlew = new Map<string, number>();
                    automationState.pluginParamSlew.set(lane.id, laneSlew);
                }

                const prev = laneSlew.get(device.id) ?? value;
                const smoothed = isDiscontinuity ? value : slewStep(prev, value, AUTOMATION_SLEW_ALPHA);
                laneSlew.set(device.id, smoothed);
                // Record the applied value even when the dispatch below
                // is suppressed as sub-epsilon — the engine still holds this
                // value (within epsilon), so it is the correct base for the
                // modulation write that follows in this same tick.
                let appliedByParameter = appliedAutomationBases.get(device.id);
                if (!appliedByParameter) {
                    appliedByParameter = new Map<string, number>();
                    appliedAutomationBases.set(device.id, appliedByParameter);
                }
                appliedByParameter.set(paramId, smoothed);
                if (isDiscontinuity || Math.abs(smoothed - prev) > SLEW_EPSILON) {
                    if (device.type === 'fermenter') {
                        // Fermenter params use camelCase ids that must be mapped to
                        // their snake_case DSP ids before reaching the WASM node —
                        // the same translation the UI bridge applies. Route through
                        // the public mapped use-case so automation and the UI share
                        // one mapping path instead of hitting Rust's silent no-op arm.
                        updateFermenterMappedParamInEngine({ deviceId: device.id, paramId, value: smoothed });
                    } else {
                        updateDeviceParam(targetOwner.trackId, targetOwner.deviceId, paramId, smoothed);
                    }
                }
                continue;
            }
            if (deviceIndex === UNRESOLVED_DEVICE_AUTOMATION_TARGET) {
                continue;
            }

            // MIDI FX Automation
            if (!getTrackEligibility(track.kind).acceptsDeviceUpdate) {
                continue;
            }
            for (const fx of track.midiFx) {
                if (fx.parameterValues[lane.parameterId] !== undefined) {
                    if (!laneSlew) {
                        laneSlew = new Map<string, number>();
                        automationState.pluginParamSlew.set(lane.id, laneSlew);
                    }
                    const prev = laneSlew.get(fx.id) ?? value;
                    const smoothed = isDiscontinuity ? value : slewStep(prev, value, AUTOMATION_SLEW_ALPHA);
                    laneSlew.set(fx.id, smoothed);
                    if (isDiscontinuity || Math.abs(smoothed - prev) > SLEW_EPSILON) {
                        updateMidiFxParam(lane.trackId, fx.id, lane.parameterId, smoothed);
                    }
                    break;
                }
            }
        }
    }

    return gainAutomationTrackIds;
}
