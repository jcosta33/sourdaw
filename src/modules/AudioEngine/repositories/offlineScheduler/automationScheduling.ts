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
import { type AudioDeviceStrategy, type OfflineAutomationSegment } from '../deviceStrategy/AudioDeviceStrategy';

import {
    type CompiledAutomationEvent,
    type CompiledValueBound,
    compileAutomationEvents,
} from './compileAutomationEvents';
import { compileAutomationSegments } from './compileAutomationSegments';
import { eventStreamFrame } from './eventStreamFrame';
import { type ScheduleCall } from './makeOfflineFrameScheduler';
import { mergeAutomationEventStreams, type AutomationEventStream } from './mergeAutomationEventStreams';
import {
    mergeAutomationSegmentStreams,
    type AutomationSegmentScope,
    type AutomationSegmentStream,
} from './mergeAutomationSegmentStreams';
import { unrenderableAutomationRefusal } from './refuseUnrenderableAutomation';
import { scheduleCompiledEventsOnParam } from './scheduleCompiledEventsOnParam';

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
 * One AudioParam target's (or the curve-write pair's) collected streams on one
 * (device, parameter) group, with the application call that consumes the one
 * spliced stream the group resolves to.
 */
type AutomationEventTargetGroup = {
    apply: (events: readonly CompiledAutomationEvent[]) => void;
    streams: AutomationEventStream[];
};

type AutomationEventGroup = {
    deviceId: string;
    parameterId: string;
    targets: AutomationEventTargetGroup[];
};

/**
 * Collect one lane's compiled events onto its (device, parameter) group — the
 * event-bound families' counterpart of the `segments` branch's group push. A
 * group's targets fill in lane order; every lane that resolves the same
 * binding visits the same targets in the same order, so the index is dense.
 */
function collectDeviceEventStream(
    groups: Map<string, AutomationEventGroup>,
    entry: {
        groupKey: string;
        deviceId: string;
        parameterId: string;
        laneId: string;
        scope: AutomationSegmentScope;
        targetIndex: number;
        events: CompiledAutomationEvent[];
        /** A clip-scoped lane's window end, region-relative seconds. */
        windowEndSeconds?: number;
        apply: (events: readonly CompiledAutomationEvent[]) => void;
    }
): void {
    let group = groups.get(entry.groupKey);
    if (!group) {
        group = { deviceId: entry.deviceId, parameterId: entry.parameterId, targets: [] };
        groups.set(entry.groupKey, group);
    }
    const targetGroup = group.targets[entry.targetIndex] ?? { apply: entry.apply, streams: [] };
    group.targets[entry.targetIndex] = targetGroup;
    targetGroup.streams.push({
        laneId: entry.laneId,
        scope: entry.scope,
        events: entry.events,
        windowEndSeconds: entry.windowEndSeconds,
    });
}

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
    /**
     * Reports every (device, parameter) group whose lanes did not all fit one
     * merged schedule — called once per group, only when
     * `mergeAutomationSegmentStreams` withheld at least one lane, naming
     * every withheld lane id. The group still applies its merged stream (see
     * the call site below); this is for a caller that must not silently lose
     * a withheld lane's writes (the live producer, the native export) and
     * decides on its own what to do about it. Optional: the Web Audio export
     * path has no per-lane fallback of its own to report through, and passes
     * none.
     */
    onWithheldDeviceLanes?: (clash: { deviceId: string; parameterId: string; laneIds: readonly string[] }) => void;
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
    events: readonly CompiledAutomationEvent[],
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
    onWithheldDeviceLanes,
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

    /**
     * Every `segments`-bound lane on one (device, parameter) collects its
     * compiled stream here instead of applying immediately, keyed by
     * `${deviceId}::${parameterId}`, alongside the lane id and scope that
     * produced each stream. A `segments` consumer keeps only its most recent
     * `apply` call, so two lanes driving one parameter used to lose every
     * lane but the last; the group applies exactly once, after the loop,
     * through `mergeAutomationSegmentStreams` (see the call site below),
     * which resolves every span by the scope law and keeps each lane's
     * material on the spans it owns.
     */
    const segmentGroupsByKey = new Map<
        string,
        {
            apply: (segments: readonly OfflineAutomationSegment[]) => void;
            deviceId: string;
            parameterId: string;
            streams: AutomationSegmentStream[];
        }
    >();

    /**
     * Every `curveWrite`-, `audioParam`-, or strip-parameter-bound lane (`gain`,
     * `pan`, an existing send) on one parameter collects its compiled events
     * here, keyed so strip parameters group per track (`track:<trackId>::…`)
     * and device parameters per device. Those families used to apply each
     * overlapping lane immediately onto the same target, so exports resolved a
     * track lane against a clip lane by lane-array insertion order — and a
     * lone one-point clip lane's `set` interleaved into the track lane's
     * timeline, re-anchoring its ramps, while live played the clip lane. The
     * group applies once, after the loop, through `mergeAutomationEventStreams`
     * — the same scope law the segments branch applies, so the applied curve
     * for one project is identical across every export family.
     */
    const eventGroupsByKey = new Map<string, AutomationEventGroup>();

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
        // The scope window the merge resolves by (#4736): a compiled stream
        // ends at its last point (plus slew settle), not where the clip does,
        // so the window end travels with the stream — region-relative seconds
        // for the event-bound families (their conversion applies no
        // compensation), and the same `eventStreamFrame` conversion the
        // segments family's own clock uses for the segments family. That
        // clock shifts by the compensation exactly when the compile's stream
        // reaches past the region start (#4684 leaves a stream whose every
        // event sits at the region start unshifted), so a window closing
        // exactly there takes no shift either — frame 0, the terminator the
        // compile actually emitted. Every shifted clock shares the same
        // offset, so a window end and the neighboring lane's opening land on
        // the same frame. The value-independent window is also what makes
        // every target of one parameter splice at the same frames.
        const clipWindowEndSeconds = activeWindowSeconds
            ? activeWindowSeconds.endSeconds - regionStartSeconds
            : undefined;
        const clipWindowEndFrame =
            clipWindowEndSeconds === undefined
                ? undefined
                : eventStreamFrame(
                      (clipWindowEndSeconds > 0 ? compensationDelaySec : 0) + clipWindowEndSeconds,
                      durationSeconds,
                      sampleRate
                  );

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
            // Collected, not applied — see `eventGroupsByKey` and the merge
            // pass after this loop. The strip families group per track: the
            // fader is one param per track, and a clip lane and the track lane
            // driving it must resolve by the scope law (#4909), not by write
            // order on the shared AudioParam.
            collectDeviceEventStream(eventGroupsByKey, {
                groupKey: `track:${trackId}::gain`,
                deviceId: trackId,
                parameterId: 'gain',
                laneId: lane.id,
                scope: lane.clipId ? 'clip' : 'track',
                targetIndex: 0,
                events: compileAutomationEvents(
                    points,
                    durationSeconds,
                    defaultTempo,
                    changes,
                    regionStartSeconds,
                    projectBeatToSeconds,
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
                ),
                windowEndSeconds: clipWindowEndSeconds,
                apply: (mergedEvents) =>
                    scheduleCompiledEventsOnParam(trackGainNode.gain, mergedEvents, compensationDelaySec),
            });
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
            collectDeviceEventStream(eventGroupsByKey, {
                groupKey: `track:${trackId}::pan`,
                deviceId: trackId,
                parameterId: 'pan',
                laneId: lane.id,
                scope: lane.clipId ? 'clip' : 'track',
                targetIndex: 0,
                events: compileAutomationEvents(
                    points,
                    durationSeconds,
                    defaultTempo,
                    changes,
                    regionStartSeconds,
                    projectBeatToSeconds,
                    { ...laneOptions, ...boundOptions }
                ),
                windowEndSeconds: clipWindowEndSeconds,
                apply: (mergedEvents) =>
                    scheduleCompiledEventsOnParam(trackPanNode.pan, mergedEvents, compensationDelaySec),
            });
            continue;
        }

        const sendParam = sendAutomationParams?.get(lane.parameterId);
        if (sendParam) {
            // Collected, not applied — see `eventGroupsByKey` and the merge
            // pass after this loop; the send pot groups per track like gain
            // and pan do.
            collectDeviceEventStream(eventGroupsByKey, {
                groupKey: `track:${trackId}::${lane.parameterId}`,
                deviceId: trackId,
                parameterId: lane.parameterId,
                laneId: lane.id,
                scope: lane.clipId ? 'clip' : 'track',
                targetIndex: 0,
                events: compileAutomationEvents(
                    points,
                    durationSeconds,
                    defaultTempo,
                    changes,
                    regionStartSeconds,
                    projectBeatToSeconds,
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
                ),
                windowEndSeconds: clipWindowEndSeconds,
                apply: (mergedEvents) => scheduleCompiledEventsOnParam(sendParam, mergedEvents, compensationDelaySec),
            });
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
                // `compensationDelaySec` shifts every emitted segment's frame
                // exactly as `scheduleAutomationOnParam` shifts its AudioParam
                // writes and `scheduleCurveWritePoints` shifts its frame writes
                // above (M-038): clip audio is delayed by the track's latency
                // compensation before it reaches the devices, so a device's
                // segment-bound automation must land on that same delayed
                // clock or the worklet steps it before the audio it shapes.
                const segments = compileAutomationSegments(
                    points,
                    durationSeconds,
                    defaultTempo,
                    changes,
                    sampleRate,
                    regionStartSeconds,
                    projectBeatToSeconds,
                    compensationDelaySec,
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
                // Collected, not applied — see `segmentGroupsByKey` and the
                // merge pass after this loop. `apply` is the same call on every
                // lane that resolves this (device, parameter) pair, so the last
                // one resolved is as good as any to hold it. The scope and the
                // window end are the resolution law's inputs (#4736): a
                // clip-scoped lane owns every span its clip window covers.
                const groupKey = `${candidate.deviceId}::${parameterId}`;
                const group = segmentGroupsByKey.get(groupKey);
                if (group) {
                    group.streams.push({
                        laneId: lane.id,
                        scope: lane.clipId ? 'clip' : 'track',
                        segments,
                        windowEndFrame: clipWindowEndFrame,
                    });
                } else {
                    segmentGroupsByKey.set(groupKey, {
                        apply: binding.apply,
                        deviceId: candidate.deviceId,
                        parameterId,
                        streams: [
                            {
                                laneId: lane.id,
                                scope: lane.clipId ? 'clip' : 'track',
                                segments,
                                windowEndFrame: clipWindowEndFrame,
                            },
                        ],
                    });
                }
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
                // The bound is the context's frame count, resolved by the same
                // `clampRenderFrameCount` the render root builds the context
                // with. Re-deriving it here as `floor(durationSeconds *
                // sampleRate)` was a frame short of the `ceil` the buffer holds
                // — durations are beat-derived, so the product is rarely whole —
                // and it dropped the write quantising to the render's last valid
                // frame, leaving the tail on the previous ceiling. It also
                // ignored the `MAX_OFFLINE_FRAMES` clamp a truncated render's
                // context actually got.
                const renderFrames = clampRenderFrameCount({ durationSeconds, sampleRate });
                const scheduleWithinRender: ScheduleCall = (time, call) => {
                    if (sampleRate > 0 && time !== undefined && Math.round(time * sampleRate) >= renderFrames) {
                        return;
                    }
                    scheduleFrame(time, call);
                };
                // Collected, not applied — see `eventGroupsByKey` and the merge
                // pass after this loop. The write schedule the group resolves
                // applies once per parameter, by the scope law, instead of two
                // lanes racing one target in lane-array order.
                collectDeviceEventStream(eventGroupsByKey, {
                    groupKey: `${candidate.deviceId}::${parameterId}`,
                    deviceId: candidate.deviceId,
                    parameterId,
                    laneId: lane.id,
                    scope: lane.clipId ? 'clip' : 'track',
                    targetIndex: 0,
                    events,
                    windowEndSeconds: clipWindowEndSeconds,
                    apply: (mergedEvents) =>
                        scheduleCurveWritePoints(
                            binding.targets,
                            mergedEvents,
                            clampStep,
                            compensationDelaySec,
                            scheduleWithinRender
                        ),
                });
                continue;
            }
            for (const [targetIndex, target] of binding.targets.entries()) {
                const { audioParam, scale, offset, convert } = target;
                // Every target of the parameter compiles the same timeline —
                // the options below differ only in how values map into the
                // param's units — so the group's scope resolution below, which
                // is decided on frames and lane order and never on values, is
                // consistent across the targets of one parameter.
                const applyMergedEvents = (mergedEvents: readonly CompiledAutomationEvent[]): void => {
                    scheduleCompiledEventsOnParam(audioParam, mergedEvents, compensationDelaySec);
                };
                if (convert) {
                    // Non-affine device→AudioParam law (dB→linear, a delay
                    // floor). Live slews, clamps and quantises in DEVICE units
                    // and converts once at `updateDeviceParam`, so the slew
                    // here must run in device units too: no affine scale or
                    // offset, the unmapped device law, and the conversion
                    // applied at write time by `emitTransform`. Only the link
                    // scale composes with the device scalar, exactly as it
                    // composes before live's parameter-family transform.
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
                            emitTransform: convert,
                        }
                    );
                    // Collected, not applied — see `eventGroupsByKey` and the
                    // merge pass after this loop.
                    collectDeviceEventStream(eventGroupsByKey, {
                        groupKey: `${candidate.deviceId}::${parameterId}`,
                        deviceId: candidate.deviceId,
                        parameterId,
                        laneId: lane.id,
                        scope: lane.clipId ? 'clip' : 'track',
                        targetIndex,
                        events,
                        windowEndSeconds: clipWindowEndSeconds,
                        apply: applyMergedEvents,
                    });
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
                const events = compileAutomationEvents(
                    points,
                    durationSeconds,
                    defaultTempo,
                    changes,
                    regionStartSeconds,
                    projectBeatToSeconds,
                    paramOptions
                );
                // Collected, not applied — see `eventGroupsByKey` and the merge
                // pass after this loop.
                collectDeviceEventStream(eventGroupsByKey, {
                    groupKey: `${candidate.deviceId}::${parameterId}`,
                    deviceId: candidate.deviceId,
                    parameterId,
                    laneId: lane.id,
                    scope: lane.clipId ? 'clip' : 'track',
                    targetIndex,
                    events,
                    windowEndSeconds: clipWindowEndSeconds,
                    apply: applyMergedEvents,
                });
            }
        }
    }

    // One `apply` per (device, parameter) group, now that every lane's stream
    // is collected: `mergeAutomationSegmentStreams` resolves the group by the
    // scope law — a clip-scoped lane owns every span its clip window covers,
    // a track-level lane owns the rest, equal scopes break to the lane latest
    // in lane-array order — and keeps every lane's material on the spans it
    // owns, so nothing is withheld and the group still applies exactly once.
    // A caller that must account for lanes the merge could not keep learns
    // about it through `onWithheldDeviceLanes`, which the total law leaves
    // silent.
    for (const { apply, deviceId, parameterId, streams } of segmentGroupsByKey.values()) {
        const merged = mergeAutomationSegmentStreams(streams);
        if (merged.withheldLaneIds.length > 0) {
            onWithheldDeviceLanes?.({ deviceId, parameterId, laneIds: merged.withheldLaneIds });
        }
        if (merged.segments.length > 0) {
            apply(merged.segments);
        }
    }

    // The event-bound families (device `audioParam`/`curveWrite` targets and
    // the strip parameters) apply once per parameter group the same way the
    // segments family applies once per group above. A lone lane keeps the
    // direct application its family always had — the merge of one stream is
    // that stream, so both routes resolve identically. Overlapping lanes
    // resolve by the scope law, and what each consumer receives is one
    // spliced event stream — an AudioParam timeline, or the curve-write
    // pair's write schedule — that plays the clip lane inside its window and
    // the track lane around it, whichever order the lanes arrived in.
    for (const { deviceId, parameterId, targets } of eventGroupsByKey.values()) {
        for (const { apply, streams } of targets) {
            if (streams.length <= 1) {
                const single = streams[0];
                if (single && single.events.length > 0) {
                    apply(single.events);
                }
                continue;
            }
            const merged = mergeAutomationEventStreams(streams, sampleRate, durationSeconds);
            if (merged.withheldLaneIds.length > 0) {
                onWithheldDeviceLanes?.({ deviceId, parameterId, laneIds: merged.withheldLaneIds });
            }
            if (merged.events.length > 0) {
                apply(merged.events);
            }
        }
    }
}
