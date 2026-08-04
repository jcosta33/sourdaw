import { getTrackEligibility, resolveEligibleDeviceWriteTarget, trackStore } from '#/modules/Arrangement/stores';
import {
    clampDeviceParameterValue,
    isDeviceParameterAutomatable,
    quantiseDeviceParameterValue,
} from '#/modules/Arrangement/useCases';
import {
    getCompensationDelay,
    getCurrentTime,
    scheduleTrackPan,
    updateDeviceParam,
    updateMidiFxParam,
} from '#/modules/AudioEngine/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { getAutomationValueAtBeat, isRecordingAutomation, resolveAutoMatchValue } from '#/modules/Automation/useCases';
import { applyFermenterRuntimeParam } from '#/modules/Fermenter/useCases';
import {
    getDeviceAutomationParameterId,
    resolveDeviceAutomationTargetIndex,
    UNRESOLVED_DEVICE_AUTOMATION_TARGET,
} from '#/utils/automationDeviceTarget';
import { AUTOMATION_SLEW_ALPHA, slewStep } from '#/utils/automationSlew';

import { schedulerSession } from '../../playheadScheduler/schedulerSession';

import { appliedAutomationBases, clearAppliedAutomationBases } from './appliedAutomationBases';
import { restoreAutomationBaseValue } from './restoreAutomationBaseValue';
import { scheduleComposedTrackGainAutomation } from './scheduleComposedTrackGainAutomation';

/**
 * Per-parameter exponential slew state for plugin automation. The IIR
 * coefficient (AUTOMATION_SLEW_ALPHA, 0.4) and its one-tick step (slewStep) are
 * the shared #/utils/automationSlew kernel the offline render replicates for
 * device-param parity (AU-2). ~95% of target reached in ~9 ticks (~90ms at
 * 100Hz). Do not re-inline the coefficient here.
 */
/** Skip dispatch when the smoothed value has moved less than this per tick. */
const SLEW_EPSILON = 5e-5;

/**
 * Whether a lane is allowed to drive this parameter on this device.
 *
 * Key presence alone used to be the whole test, and the key is present for any
 * parameter a panel has ever written — so a lane the picker would refuse to
 * create drove the parameter at full range once it arrived from a preset, a
 * project file or a model action. The declared flag is now read here, where the
 * decision is actually made, rather than only where lanes are offered.
 */
function deviceAcceptsAutomationParameter(
    device: { type: string; parameterValues: Record<string, number> },
    parameterId: string
): boolean {
    if (device.parameterValues[parameterId] === undefined) {
        return false;
    }

    return isDeviceParameterAutomatable({ deviceType: device.type, paramId: parameterId });
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
        // applyFermenterRuntimeParam / updateMidiFxParam), which apply on the next
        // render block and cannot be JS-scheduled a-rate here — they keep the
        // tick-grid apply + exponential slew (with the #746 discontinuity snap).
        // Offline export already schedules every family a-rate
        // (scheduleAutomationOnParam); this closes the live half for the
        // AudioParam-backed families only.
        if (lane.parameterId === 'gain') {
            scheduleComposedTrackGainAutomation({
                trackId: lane.trackId,
                vcaGroupId: track.vcaGroupId,
                value,
                minValue: lane.minValue,
                time: now + compensationFor(lane.trackId),
            });
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
                const slewed = isDiscontinuity ? value : slewStep(prev, value, AUTOMATION_SLEW_ALPHA);
                // Lane data is validated on load only for finiteness and
                // `maxValue >= minValue` — never against the descriptor — so a
                // stored curve can ask for anything. The declared range binds
                // here just as it does on a direct write.
                const smoothed = clampDeviceParameterValue({ deviceType: device.type, paramId, value: slewed });
                // The slew state stays in the *continuous* domain deliberately.
                // A parameter the descriptor declares `int`/`bool`/`choice` may
                // only be delivered as an integer, but rounding the value the
                // filter feeds itself puts a dead zone in the recurrence — at
                // α = 0.4, `slewStep(5, 6)` is 5.4, which rounds back to 5 for
                // ever — so a ride to engine index 6 would stall at 5. Filter
                // continuously, quantise once on the way out.
                laneSlew.set(device.id, smoothed);
                const delivered = quantiseDeviceParameterValue({
                    deviceType: device.type,
                    paramId,
                    value: smoothed,
                });
                // Record the applied value even when the dispatch below
                // is suppressed as sub-epsilon — the engine still holds this
                // value (within epsilon), so it is the correct base for the
                // modulation write that follows in this same tick. It is the
                // *delivered* value that is recorded: that is what the engine
                // actually holds once the parameter is stepped.
                let appliedByParameter = appliedAutomationBases.get(device.id);
                if (!appliedByParameter) {
                    appliedByParameter = new Map<string, number>();
                    appliedAutomationBases.set(device.id, appliedByParameter);
                }
                appliedByParameter.set(paramId, delivered);
                // A stepped parameter's filter keeps moving long after the
                // delivered integer has stopped changing, so the sub-epsilon
                // gate alone would re-send an identical index to the worklet on
                // every tick of the glide. Suppressing a repeat is the same rule
                // the epsilon gate already states — do not write a value the
                // engine is already holding — read on the delivered domain. For
                // a `float` parameter `delivered === smoothed` and
                // `previousDelivered === prev`, so this changes nothing there.
                //
                // Known cost, deliberately accepted: this widens the window in
                // which a *foreign* write to the same parameter goes
                // un-re-asserted. The slew cannot strand a value — at α = 0.4 it
                // clears SLEW_EPSILON within two ticks of any real movement — but
                // `pluginParamSlew` is only dropped on a gate edge or an
                // AutoMatch release, never on a device reload or a bypass
                // toggle, so on a slow ramp across an index a value another
                // writer clobbered can stay clobbered for roughly a second
                // rather than ~10 ms. Closing that means clearing the slew on
                // those two events, which is a scheduler-lifecycle change and
                // not part of this one.
                const previousDelivered = quantiseDeviceParameterValue({
                    deviceType: device.type,
                    paramId,
                    value: prev,
                });
                if (isDiscontinuity || (Math.abs(smoothed - prev) > SLEW_EPSILON && delivered !== previousDelivered)) {
                    if (device.type === 'fermenter') {
                        // Fermenter params use camelCase ids that must be mapped to
                        // their snake_case DSP ids before reaching the WASM node —
                        // the same translation the UI bridge applies. Runtime
                        // automation bypasses UI state and persistence so the
                        // user's manual base and CRDT history remain unchanged.
                        applyFermenterRuntimeParam({ deviceId: device.id, paramId, value: delivered });
                    } else {
                        updateDeviceParam(targetOwner.trackId, targetOwner.deviceId, paramId, delivered);
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
                if (fx.parameterValues[lane.parameterId] === undefined) {
                    continue;
                }

                // The owning MIDI FX is found by key presence, but whether a
                // curve may drive that key is the descriptor's call, exactly as
                // it is for a device param forty lines above. Note what this
                // gate can actually decide today: `fx.type` is a Yeast
                // `ProcessorType` and the lookup keys on `PluginDescriptor.id`,
                // so it resolves nothing and the permissive "no declared
                // contract" branch is the only one reachable. It stays because
                // it is the gate a `ProcessorType`-keyed descriptor would flow
                // through — but it is not enforcing anything right now.
                if (!isDeviceParameterAutomatable({ deviceType: fx.type, paramId: lane.parameterId })) {
                    break;
                }

                if (!laneSlew) {
                    laneSlew = new Map<string, number>();
                    automationState.pluginParamSlew.set(lane.id, laneSlew);
                }
                const prev = laneSlew.get(fx.id) ?? value;
                const slewedFxValue = isDiscontinuity ? value : slewStep(prev, value, AUTOMATION_SLEW_ALPHA);
                const smoothed = clampDeviceParameterValue({
                    deviceType: fx.type,
                    paramId: lane.parameterId,
                    value: slewedFxValue,
                });
                laneSlew.set(fx.id, smoothed);
                // MIDI FX parameters are delivered UNQUANTISED, and that is a
                // statement of fact rather than a policy: `fx.type` is a Yeast
                // `ProcessorType` ('arpeggiator', 'euclidean', …), and the
                // quantiser keys on `PluginDescriptor.id`. The two name spaces
                // are disjoint (asserted in Yeast's `ProcessorCatalog.spec.ts`),
                // so `getPluginById(fx.type)` is `undefined` for every processor
                // that exists and a quantise call here could never do anything.
                // Writing one anyway would read as coverage this branch does not
                // have.
                //
                // Some of these parameters really are stepped —
                // `EuclideanGenerator` uses `steps`/`hits` as loop bounds and a
                // modulus, so a slewed 12.6 builds a 12-long pattern and walks it
                // 13 wide. Closing that needs descriptors keyed by
                // `ProcessorType`, which is its own change; it is not closed here.
                if (isDiscontinuity || Math.abs(smoothed - prev) > SLEW_EPSILON) {
                    updateMidiFxParam(lane.trackId, fx.id, lane.parameterId, smoothed);
                }
                break;
            }
        }
    }

    return gainAutomationTrackIds;
}
