import { clampFaderGain, dbToGain } from '#/utils/audioLevelLaw';
import { getDeviceAutomationParameterId, resolveDeviceAutomationTargetIndex } from '#/utils/automationDeviceTarget';
import { boundAutomationLaneValue } from '#/utils/automationLaneBound';
import { resolveLinkedLane } from '#/utils/automationLaneLink';
import { AUTOMATION_SLEW_ALPHA } from '#/utils/automationSlew';

import { createExportError } from '../../errors/ExportError';
import { type AutomationLane } from '../../models/AutomationViewTypes';
import { type OfflineCurveWriteTargets } from '../../models/OfflineCurveWriteTargets';
import { beatToSeconds } from '../../services/beatConversion';
import { clampRenderFrameCount } from '../clampRenderFrameCount';
import { applyLimiterCeilingWrite } from '../devices/dynamics/applyLimiterCeilingWrite';
import { type AudioDeviceStrategy } from '../deviceStrategy/AudioDeviceStrategy';

import {
    type CompiledAutomationEvent,
    type CompiledValueBound,
    compileAutomationEvents,
} from './compileAutomationEvents';
import { compileAutomationSegments } from './compileAutomationSegments';
import { type ScheduleCall } from './makeOfflineFrameScheduler';
import { quantiseSuspendFrame } from './quantiseSuspendFrame';
import { unrenderableAutomationRefusal } from './refuseUnrenderableAutomation';
import { scheduleAutomationOnParam } from './scheduleAutomationOnParam';

type AutomationTempoChange = {
    beat: number;
    tempo: number;
};

type ScheduleTrackAutomationDeviceEntry = {
    deviceId: string;
    deviceType: string;
    strategy: Pick<AudioDeviceStrategy, 'resolveOfflineAutomation'>;
    /**
     * Whether this device's strip prints. Carried from the chain entry rather
     * than re-derived here, because re-deriving reachability would be a second
     * source of truth for the question `buildDeviceChain` already answered.
     */
    contributesAudio: boolean;
};

/**
 * The two parts of the device-parameter contract the live apply path enforces,
 * handed in by the calling render use case.
 *
 * Both live in `Arrangement`'s `DeviceParameterLaw`, which this repository may
 * not import (a repository must not reach into another module's business
 * contracts). Passing them in is what stops the offline path re-deciding the
 * question — the divergence being closed here is precisely that it used to have
 * no answer at all, so a lane the monitor refused to run still rendered into the
 * bounce, and a lane that overshot its declared range rendered past the value
 * the monitor clamped it to.
 */
export type OfflineDeviceAutomationLaw = {
    /**
     * `applyAutomation`'s `deviceAcceptsAutomationParameter`: the device carries
     * this key in `parameterValues` **and** the descriptor declares it
     * automatable. Resolution has to run on the same predicate live runs on, or
     * a legacy bare lane can resolve to a different device offline.
     */
    acceptsAutomation: (input: { deviceId: string; deviceType: string; parameterId: string }) => boolean;
    /**
     * `clampDeviceParameterValue`: the declared range, applied to every write.
     *
     * The device is named as well as its type because a hosted plugin's range
     * is published by the *instance*: every external plugin device spells one
     * device type, so a law given only the type could not tell two plugins on
     * one strip apart and would hold both to whichever it resolved first.
     */
    clampValue: (input: { deviceId: string; deviceType: string; paramId: string; value: number }) => number;
    /**
     * `quantiseDeviceParameterValue`: the declared *type*, applied to the value
     * that is emitted — never to the value the slew feeds itself.
     *
     * Live splits these two deliberately (`applyAutomation`: `slewStep` → clamp →
     * `laneSlew.set(smoothed)` → quantise → `updateDeviceParam`). Rounding inside
     * the recurrence would dead-zone it: at α = 0.4, `slewStep(5, 6)` is 5.4,
     * which rounds back to 5 for ever, so a ride to index 6 stalls at 5. Offline
     * has to make the same split, or a lane on an `int` parameter renders the
     * filter state — 14.4, 13.44, 12.864 for a value the monitor delivers as
     * 14, 13, 12.
     */
    quantiseValue: (input: { deviceId: string; deviceType: string; paramId: string; value: number }) => number;
};

export type ScheduleTrackAutomationInput = {
    lanes: AutomationLane[];
    trackId: string;
    /**
     * Structural on purpose — `.gain`/`.pan` is the whole of what this
     * scheduler reads off the two nodes, and stating only that is what lets
     * the native export path (#2225) hand in a recording `AudioParam` and
     * receive the same compiled writes the Web Audio path receives, instead of
     * keeping a second copy of the lane laws. A real `GainNode` and
     * `StereoPannerNode` satisfy these unchanged.
     */
    trackGainNode: { gain: AudioParam };
    trackPanNode: { pan: AudioParam };
    /** App-owned graph bindings keyed by the persisted `send:<busId>` target. */
    sendAutomationParams?: ReadonlyMap<string, AudioParam>;
    deviceEntries: ScheduleTrackAutomationDeviceEntry[];
    durationSeconds: number;
    defaultTempo: number;
    changes: AutomationTempoChange[];
    /**
     * Seconds between live slew ticks — `scheduleGrainMs / 1000`, read off the
     * same transport state `startPlayheadScheduler` reads. Required, and with no
     * default on purpose: a default is a second source of truth that agrees with
     * the monitor only at the shipping grain.
     */
    slewTickSeconds: number;
    deviceParameterLaw: OfflineDeviceAutomationLaw;
    /**
     * The offline render's frame scheduler for this context, threaded down by
     * the render root. `makeOfflineFrameScheduler` returns the context's single
     * shared instance, so a Faust device's note calls and these writes ride the
     * same suspend per frame no matter which caller asks.
     *
     * A frame-addressed lane (see `OfflineAutomationBinding`'s `curveWrite`
     * kind) has no `AudioParam`, so its writes land on this. Optional because
     * the recording projection runs the same lane laws with no context of its
     * own — and a curve-addressed lane reached there fails closed rather than
     * being dropped, because a projector that cannot carry it must not report
     * the lane as converted.
     */
    scheduleFrame?: ScheduleCall;
    regionStartSeconds?: number;
    projectBeatToSeconds?: (beat: number) => number;
    sampleRate?: number;
    compensationDelaySec?: number;
    clipBoundsById?: Map<string, { startBeat: number; endBeat: number }>;
    /**
     * The track's VCA group master as a plain multiplier (`1` outside a group).
     * Resolved by the calling render use case and passed in, because this
     * repository must not reach into Arrangement's VCA read model itself.
     */
    vcaMultiplier?: number;
    /**
     * Automation's `getAutomationLaneCeiling`: the ceiling a lane really has,
     * which is not always the scalar it stores. A track gain lane written
     * before the fader gained its `+6 dB` of headroom still records
     * `maxValue: 1`.
     *
     * Handed in for the same reason `deviceParameterLaw` and `vcaMultiplier`
     * are — this repository may not reach into another module's business
     * contracts, and the failure being closed is precisely that the offline
     * path had no answer of its own, so it printed a level the monitor never
     * played. Required, with no default: a default here would be a second
     * source of truth that agrees with the monitor only until the law moves.
     */
    resolveLaneCeiling: (lane: Pick<AutomationLane, 'parameterId' | 'minValue' | 'maxValue' | 'clipId'>) => number;
};

/**
 * The offline half of the live path's `clampToLaneRange` — the shared
 * `boundAutomationLaneValue` kernel (`#/utils/automationLaneBound`), evaluated
 * on the same inputs. The law and its reasons live on the kernel; this wrapper
 * resolves the lane's floor, declared ceiling and derived ceiling once per lane
 * — all three are pure functions of the lane, so resolving them here rather
 * than once per value changes nothing about the result. The bracket stays a
 * parameter, because it is the one input that varies per value, and
 * `compileAutomationEvents` supplies the same pair live's binary search does.
 *
 * Returns `undefined` when the lane declares no usable range, matching live's
 * non-finite guard — several specs build lanes with only the fields their
 * assertions touch, and a `NaN` bound would silence the render.
 */
function resolveLaneValueBound(
    sourceLane: Pick<AutomationLane, 'minValue' | 'maxValue'>,
    derivedCeiling: number
): CompiledValueBound | undefined {
    const floor = sourceLane.minValue;
    const declared = sourceLane.maxValue;
    if (!Number.isFinite(floor) || !Number.isFinite(declared)) {
        return undefined;
    }
    return (value, segmentFirstValue, segmentSecondValue) =>
        boundAutomationLaneValue({
            value,
            declaredMin: floor,
            declaredMax: declared,
            derivedCeiling,
            segmentFirstValue,
            segmentSecondValue,
        });
}

/**
 * Write a frame-addressed lane's compiled points through the render's frame
 * scheduler.
 *
 * A value with no `AudioParam` cannot be ramped: each compiled point rebuilds
 * the device-side curve and Web Audio holds it until the next point, so the
 * writes are discrete and land on the frames the compiled points fall on. The
 * caller compiles those points with the same device slew the other
 * device-parameter branches use, so they are the glided grid the monitor
 * follows rather than one write per source point. The `compensationDelaySec`
 * shift is `scheduleAutomationOnParam`'s, for its reason (M-038): clip audio is
 * shifted by the track's latency compensation, so the automation that shapes it
 * must shift identically, and the region-start seed is re-anchored at 0 so the
 * gap the shift opens holds the lane's opening value.
 */
function scheduleCurveWritePoints(
    targets: OfflineCurveWriteTargets,
    events: CompiledAutomationEvent[],
    clampValue: (value: number) => number,
    compensationDelaySec: number,
    scheduleFrame: ScheduleCall
): void {
    const seed = events[0];
    if (compensationDelaySec > 0 && seed && seed.type === 'set' && seed.timeSeconds === 0) {
        const seedValue = clampValue(seed.value);
        scheduleFrame(0, () => applyLimiterCeilingWrite(targets, seedValue));
    }
    for (const event of events) {
        const value = clampValue(event.value);
        scheduleFrame(event.timeSeconds + compensationDelaySec, () => applyLimiterCeilingWrite(targets, value));
    }
}

export function scheduleTrackAutomation({
    lanes,
    trackId,
    trackGainNode,
    trackPanNode,
    sendAutomationParams,
    deviceEntries,
    durationSeconds,
    defaultTempo,
    changes,
    slewTickSeconds,
    deviceParameterLaw,
    scheduleFrame,
    regionStartSeconds = 0,
    projectBeatToSeconds,
    sampleRate = 44_100,
    compensationDelaySec = 0,
    clipBoundsById,
    vcaMultiplier = 1,
    resolveLaneCeiling,
}: ScheduleTrackAutomationInput): void {
    const projectBeat = projectBeatToSeconds ?? ((beat) => beatToSeconds(beat, defaultTempo, changes));
    const laneById = new Map<string, AutomationLane>();
    for (const lane of lanes) {
        laneById.set(lane.id, lane);
    }
    // AU-2: device/MIDI-FX params carry the live control slew; gain/pan do not.
    // The tick grid is the live scheduler grain, not a constant — see
    // `automationSlewTickSecondsForGrain`.
    const deviceSlewGrid = { alpha: AUTOMATION_SLEW_ALPHA, tickSeconds: slewTickSeconds };

    // AU-12: track-level lanes (no clipId) AND clip-scoped lanes both render; a
    // clip lane emits only within its clip span (activeWindowSeconds below).
    // A lane the project marks disabled drives nothing — offline as live.
    // Compared against `false` (not falsy) so a lane persisted before the flag
    // existed, which normalizes to `enabled: true`, still renders.
    const trackLanes = lanes.filter((lane) => lane.trackId === trackId && lane.enabled !== false);

    for (const lane of trackLanes) {
        let activeWindowSeconds: { startSeconds: number; endSeconds: number } | undefined;
        if (lane.clipId) {
            const bounds = clipBoundsById?.get(lane.clipId);
            if (!bounds) {
                continue;
            }
            activeWindowSeconds = {
                startSeconds: projectBeat(bounds.startBeat),
                endSeconds: projectBeat(bounds.endBeat),
            };
        }

        // AU-3: follow linked lanes to the authoritative source (cycle-guarded,
        // linkScale accumulated) exactly as the live path does — offline
        // previously read raw `lane.points` and rendered a link-only lane silent.
        // The target (gain/pan/device) stays this lane's; values come from the
        // resolved source.
        const resolved = resolveLinkedLane(lane.id, (id) => laneById.get(id));
        if (!resolved) {
            continue;
        }
        const sourceLane = laneById.get(resolved.sourceLaneId);
        if (!sourceLane || sourceLane.points.length === 0) {
            continue;
        }
        // AU-3: the live path evaluates the source curve, then multiplies the
        // resolved scale into the *scalar output* once — so a bezier segment's
        // cp1.y/cp2.y are evaluated unscaled. Match it: pass the unscaled source
        // points and apply linkScale as compileAutomationEvents' affine
        // `valueScale`, never a pre-scale of point.value (which would leave
        // bezier control points unscaled and distort the curve).
        const points = sourceLane.points;
        const laneScale = resolved.scale;

        // #2538/#2539: the lane's declared range, applied where live applies it
        // to EVERY lane family — inside `getAutomationValueAtBeat`, per segment,
        // to the interpolated scalar before the link scale and before any
        // parameter-family transform below. Live has no "unbounded" branch, so
        // offline has none either: before this, only the gain branch carried the
        // bound and a smooth curve overshooting a pan, send or device lane's
        // declared range printed into the bounce at a level the monitor had
        // clamped away. A parameter-family transform (`clampFaderGain`, the
        // send's [0, 1], the device law) is not this bound and never was —
        // those clamp what the strip or parameter may hold, not what the lane's
        // own points declare. `compileAutomationEvents` runs the bound per
        // segment, against the same bracketing pair live's lookup hands it.
        const valueBound = resolveLaneValueBound(sourceLane, resolveLaneCeiling(sourceLane));
        const laneOptions =
            activeWindowSeconds || laneScale !== 1 ? { activeWindowSeconds, valueScale: laneScale } : undefined;
        const boundOptions = valueBound ? { valueBound } : {};

        if (lane.parameterId === 'gain') {
            // The fader level law is the live path's, applied offline too.
            // Live `applyAutomation` reads a lane with `minValue < 0` as a
            // decibel lane and writes `dbToGain(value)`, and `TrackNode` clamps
            // every fader write to [0, 1]; offline wrote the raw curve straight
            // onto GainNode.gain, so a dB lane rendered its dB numbers as linear
            // amplitude and a >unity point bounced louder than it can ever play
            // back. `valueTransform` runs after linkScale, matching the live
            // order (scale the dB scalar, then convert, then clamp).
            const isDecibelLane = lane.minValue < 0;
            scheduleAutomationOnParam(
                trackGainNode.gain,
                points,
                durationSeconds,
                defaultTempo,
                changes,
                regionStartSeconds,
                projectBeatToSeconds,
                compensationDelaySec,
                {
                    ...laneOptions,
                    ...boundOptions,
                    // The VCA group master composes in exactly where live puts
                    // it: after the dB→linear conversion and before the fader
                    // clamp (`dbToGain(value) * vcaMultiplier` handed to
                    // `scheduleTrackGain`, clamped inside `TrackNode`). Folding
                    // it into `valueScale` instead would apply it ahead of the
                    // dB conversion and scale decibels, not amplitude.
                    valueTransform: (value) =>
                        clampFaderGain((isDecibelLane ? dbToGain(value) : value) * vcaMultiplier),
                }
            );
            continue;
        }

        if (lane.parameterId === 'pan') {
            // No `valueTransform` here, live or offline: live maps the bounded
            // lane value through `fromStereoPan(value)` (× `PAN_SCALE_MAX`,
            // `#/utils/audioLevelLaw`) and `TrackNode` clamps the
            // AudioParam's nominal [-1, 1] on every write; offline writes the
            // same bounded value in pan units and the platform applies that
            // same nominal clamp. The nominal range is the *param's* law — the
            // lane's declared range is the one the bound above applies, and a
            // lane persisted with a range narrower than [-1, 1] must be held to
            // its own range offline exactly as `getAutomationValueAtBeat` holds
            // it live, not released to the param's wider nominal range (#2538).
            scheduleAutomationOnParam(
                trackPanNode.pan,
                points,
                durationSeconds,
                defaultTempo,
                changes,
                regionStartSeconds,
                projectBeatToSeconds,
                compensationDelaySec,
                { ...laneOptions, ...boundOptions }
            );
            continue;
        }

        const sendParam = sendAutomationParams?.get(lane.parameterId);
        if (sendParam) {
            scheduleAutomationOnParam(
                sendParam,
                points,
                durationSeconds,
                defaultTempo,
                changes,
                regionStartSeconds,
                projectBeatToSeconds,
                compensationDelaySec,
                {
                    ...laneOptions,
                    ...boundOptions,
                    // The send pot's own [0, 1] law, in live's position: live
                    // bounds the lane value in `getAutomationValueAtBeat`, then
                    // `TrackNode.scheduleSendAutomation` clamps [0, 1] on the
                    // write. `valueBound` (per segment, before this transform)
                    // is the lane's declared range — NOT always [0, 1]. The
                    // hardcoded clamp below used to be the only bound this
                    // branch carried, so a lane declaring a narrower range
                    // printed its overshoot into the bounce while the monitor
                    // held it at the declared ceiling (#2538).
                    valueTransform: (value) => Math.max(0, Math.min(1, value)),
                }
            );
            continue;
        }

        // Resolve the target on the *live* predicate, then ask whether that
        // device can be automated offline. Two steps, not one conjunction: a
        // conjunction can hand a legacy bare lane to a different device than the
        // monitor picked, because ambiguity is resolved over whichever devices
        // the predicate admitted.
        const deviceIndex = resolveDeviceAutomationTargetIndex(lane.parameterId, deviceEntries, (candidate, id) =>
            deviceParameterLaw.acceptsAutomation({
                deviceId: candidate.deviceId,
                deviceType: candidate.deviceType,
                parameterId: id,
            })
        );
        const parameterId = getDeviceAutomationParameterId(lane.parameterId);
        if (deviceIndex >= 0 && parameterId) {
            const candidate = deviceEntries[deviceIndex]!;
            const binding = candidate.strategy.resolveOfflineAutomation(parameterId);
            if (!binding) {
                // A parameter this strategy cannot bind offline is dropped
                // without failing an unrelated print. Some are true structural
                // exemptions (a reverb impulse re-render); others are known
                // silent gaps the offline automation census carries as reasoned
                // rows (#3739). The limiter ceiling used to be one of these; it
                // resolves a `curveWrite` binding now (#4437), and a
                // frame-addressed lane that cannot be written does refuse — see
                // the branch below.
                continue;
            }
            const clampStep = (value: number): number =>
                deviceParameterLaw.clampValue({
                    deviceId: candidate.deviceId,
                    deviceType: candidate.deviceType,
                    paramId: parameterId,
                    value,
                });
            // Deliberately NOT composed into `clampStep`: that function is the
            // recurrence's feedback, and rounding there dead-zones the glide.
            // This one runs on the emitted sample only — the offline analogue of
            // live's `quantiseDeviceParameterValue(smoothed)` just before
            // `updateDeviceParam`.
            const quantiseEmit = (value: number): number =>
                deviceParameterLaw.quantiseValue({
                    deviceId: candidate.deviceId,
                    deviceType: candidate.deviceType,
                    paramId: parameterId,
                    value,
                });
            if (binding.kind === 'segments') {
                const segments = compileAutomationSegments(
                    points,
                    durationSeconds,
                    defaultTempo,
                    changes,
                    sampleRate,
                    regionStartSeconds,
                    projectBeatToSeconds,
                    {
                        // The lane's declared range runs before the device law,
                        // exactly where live runs it: `getAutomationValueAtBeat`
                        // bounds the curve, then `applyAutomation` slews and
                        // applies `clampDeviceParameterValue` (#2538). The
                        // device law below is the *parameter's* range — a
                        // different, usually wider question than what this
                        // lane's own points declare.
                        ...boundOptions,
                        slew: { ...deviceSlewGrid, clampStep, quantiseEmit },
                        activeWindowSeconds,
                        valueScale: laneScale,
                    }
                );
                binding.apply(segments);
                continue;
            }
            if (binding.kind === 'curveWrite') {
                if (!scheduleFrame) {
                    // Fail closed: this lane's writes have nowhere to land, and a
                    // bare `continue` would report the render successful with the
                    // lane's moves missing from it. Only a strip that prints
                    // refuses — a strip that cannot reach the print contributes
                    // silence by construction, so failing over its lane would
                    // fail an export over audio that was never going to be in it
                    // (#4376); the refusal answers `null` for it.
                    const refusal = unrenderableAutomationRefusal({
                        deviceType: candidate.deviceType,
                        parameterId,
                        contributesAudio: candidate.contributesAudio,
                    });
                    if (refusal === null) {
                        continue;
                    }
                    throw createExportError(refusal);
                }
                // The lane's declared range runs before the device law, exactly
                // as it does for the other two kinds (#2538); `scheduleCurveWritePoints`
                // applies the device clamp to every emitted point. The slew is
                // the other branches' too: live runs `slewStep` then the
                // declared-range clamp on every device parameter including this
                // one (`applyAutomation`), so without it the export stepped the
                // ceiling at each point while the monitor glided between them.
                const events = compileAutomationEvents(
                    points,
                    durationSeconds,
                    defaultTempo,
                    changes,
                    regionStartSeconds,
                    projectBeatToSeconds,
                    {
                        ...boundOptions,
                        slew: { ...deviceSlewGrid, clampStep, quantiseEmit },
                        activeWindowSeconds,
                        valueScale: laneScale,
                    }
                );
                // A write the render cannot reach is dropped, for a reason the
                // AudioParam kinds do not have: `OfflineAudioContext.suspend`
                // rejects a time at or past the render's last frame, and the
                // frame scheduler's rejection fallback fires the callback at
                // once — an end-of-render ceiling applied from frame 0 for the
                // whole buffer. Such a write could not reach the buffer anyway,
                // while a write inside the render is scheduled as it always was.
                //
                // Reachability is the quantised suspend frame, not the raw
                // request frame: the context rounds the suspend time down to the
                // nearest render-quantum boundary (`quantiseSuspendFrame`), so a
                // request a few frames past a boundary still suspends inside the
                // render and a `>= renderFrames` check on the raw frame drops it.
                //
                // The bound is the context's frame count, resolved by the same
                // `clampRenderFrameCount` the render root builds the context
                // with, so a beat-derived duration's `ceil` and a truncated
                // render's `MAX_OFFLINE_FRAMES` cap both apply.
                const renderFrames = clampRenderFrameCount({ durationSeconds, sampleRate });
                const scheduleWithinRender: ScheduleCall = (time, call) => {
                    if (sampleRate <= 0 || time === undefined) {
                        scheduleFrame(time, call);
                        return;
                    }
                    const requestFrame = Math.max(0, Math.round(time * sampleRate));
                    if (quantiseSuspendFrame(requestFrame) >= renderFrames) {
                        return;
                    }
                    scheduleFrame(time, call);
                };
                scheduleCurveWritePoints(
                    binding.targets,
                    events,
                    clampStep,
                    compensationDelaySec,
                    scheduleWithinRender
                );
                continue;
            }
            for (const target of binding.targets) {
                const { audioParam, scale, offset, convert } = target;
                if (convert) {
                    // Non-affine device→AudioParam law (dB→linear, a delay
                    // floor). Live slews, clamps and quantises in DEVICE units
                    // and converts once at `updateDeviceParam`, so the slew
                    // here must run in device units too: no affine scale or
                    // offset, the unmapped device law, and the conversion
                    // applied at write time by `emitTransform`. Only the link
                    // scale composes with the device scalar, exactly as it
                    // composes before live's parameter-family transform.
                    scheduleAutomationOnParam(
                        audioParam,
                        points,
                        durationSeconds,
                        defaultTempo,
                        changes,
                        regionStartSeconds,
                        projectBeatToSeconds,
                        compensationDelaySec,
                        {
                            ...boundOptions,
                            slew: { ...deviceSlewGrid, clampStep, quantiseEmit },
                            activeWindowSeconds,
                            valueScale: laneScale,
                            emitTransform: convert,
                        }
                    );
                    continue;
                }
                // Compose linkScale with the device binding's unit scale/offset as
                // one affine post-transform: paramValue = interpolate(source) *
                // (linkScale * scale) + offset — evaluated on the unscaled source
                // curve (AU-3), never a pre-scale of point.value.
                //
                // The declared-range clamp is a law on the *device parameter*, but
                // the value inside the slew here is already in AudioParam units.
                // Map back through the binding's affine, clamp, map forward. The
                // affine is monotone and invertible, and `slewStep` is affine-
                // equivariant, so this is exactly the live device-space
                // recurrence viewed in AudioParam units — not an approximation.
                const clampScaledStep =
                    scale === 0
                        ? undefined
                        : (scaled: number): number => clampStep((scaled - offset) / scale) * scale + offset;
                // The type law is a law on the *device* value too, so it maps
                // back through the same affine before rounding and forward after.
                // Rounding in AudioParam units would snap to a grid of 1 there —
                // for a binding with `scale: 10` that is a tenth of a bit depth.
                const quantiseScaledEmit =
                    scale === 0
                        ? undefined
                        : (scaled: number): number => quantiseEmit((scaled - offset) / scale) * scale + offset;
                const paramOptions = {
                    // Same order as the segments binding above: the lane's
                    // declared range on the unscaled source curve, before
                    // the binding's affine and before the slew's device-law
                    // clamp (#2538).
                    ...boundOptions,
                    slew: { ...deviceSlewGrid, clampStep: clampScaledStep, quantiseEmit: quantiseScaledEmit },
                    activeWindowSeconds,
                    valueScale: laneScale * scale,
                    valueOffset: offset,
                };
                scheduleAutomationOnParam(
                    audioParam,
                    points,
                    durationSeconds,
                    defaultTempo,
                    changes,
                    regionStartSeconds,
                    projectBeatToSeconds,
                    compensationDelaySec,
                    paramOptions
                );
            }
        }
    }
}
