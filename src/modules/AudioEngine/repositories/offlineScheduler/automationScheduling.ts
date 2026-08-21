import { clampFaderGain, dbToGain } from '#/utils/audioLevelLaw';
import { getDeviceAutomationParameterId, resolveDeviceAutomationTargetIndex } from '#/utils/automationDeviceTarget';
import { resolveLinkedLane } from '#/utils/automationLaneLink';
import { AUTOMATION_SLEW_ALPHA } from '#/utils/automationSlew';

import { type AutomationLane } from '../../models/AutomationViewTypes';
import { beatToSeconds } from '../../services/beatConversion';
import { type AudioDeviceStrategy } from '../deviceStrategy/AudioDeviceStrategy';

import { type CompiledValueBound } from './compileAutomationEvents';
import { compileAutomationSegments } from './compileAutomationSegments';
import { scheduleAutomationOnParam } from './scheduleAutomationOnParam';

type AutomationTempoChange = {
    beat: number;
    tempo: number;
};

type ScheduleTrackAutomationDeviceEntry = {
    deviceId: string;
    deviceType: string;
    strategy: Pick<AudioDeviceStrategy, 'resolveOfflineAutomation'>;
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
    /** `clampDeviceParameterValue`: the declared range, applied to every write. */
    clampValue: (input: { deviceType: string; paramId: string; value: number }) => number;
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
    quantiseValue: (input: { deviceType: string; paramId: string; value: number }) => number;
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
 * The offline half of the live path's `clampToLaneRange` — the same function,
 * evaluated on the same inputs.
 *
 * Live bounds an interpolated value by the source lane's declared range, raised
 * only as far as the two stored points bracketing the segment in play actually
 * reach, and never past the derived ceiling. This body is that arithmetic with
 * the lane's floor, its declared ceiling and its derived ceiling closed over —
 * all three are pure functions of the lane, so resolving them once per lane
 * rather than once per value changes nothing about the result. The bracket
 * stays a parameter, because it is the one input that varies per value, and
 * `compileAutomationEvents` supplies the same pair live's binary search does.
 *
 * That the raise is segment-local is not an implementation detail either side
 * may relax. A legacy gain lane with a peak in one segment and a plateau in
 * another has a lane-wide maximum higher than any point bracketing the plateau,
 * and a bound built from that maximum lets the plateau's Catmull-Rom overshoot
 * through — the monitor holds it at the declared ceiling while the bounce
 * prints the overshoot, at the same playhead position.
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
    return (value, segmentFirstValue, segmentSecondValue) => {
        let ceiling = declared;
        if (derivedCeiling > declared) {
            const highestStored = Math.max(segmentFirstValue, segmentSecondValue);
            if (highestStored > declared) {
                ceiling = Math.min(derivedCeiling, highestStored);
            }
        }
        return Math.min(ceiling, Math.max(floor, value));
    };
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

        const laneOptions =
            activeWindowSeconds || laneScale !== 1 ? { activeWindowSeconds, valueScale: laneScale } : undefined;

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
            // The lane's own declared range, applied where live applies it —
            // to the interpolated scalar, per segment, before the link scale
            // and before the fader law. `clampFaderGain` alone is not this
            // bound and never was: it stops the strip at `FADER_MAX_GAIN`,
            // which used to be `1` and so happened to coincide with a legacy
            // gain lane's declared `1`. Once the fader widened, the two parted,
            // and every smooth gain ride cresting near unity printed the
            // spline's overshoot the monitor had clamped away — a bounce louder
            // than the mix, on a project nobody edited.
            const valueBound = resolveLaneValueBound(sourceLane, resolveLaneCeiling(sourceLane));
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
                    ...(valueBound ? { valueBound } : {}),
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
            scheduleAutomationOnParam(
                trackPanNode.pan,
                points,
                durationSeconds,
                defaultTempo,
                changes,
                regionStartSeconds,
                projectBeatToSeconds,
                compensationDelaySec,
                laneOptions
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
                continue;
            }
            const clampStep = (value: number): number =>
                deviceParameterLaw.clampValue({ deviceType: candidate.deviceType, paramId: parameterId, value });
            // Deliberately NOT composed into `clampStep`: that function is the
            // recurrence's feedback, and rounding there dead-zones the glide.
            // This one runs on the emitted sample only — the offline analogue of
            // live's `quantiseDeviceParameterValue(smoothed)` just before
            // `updateDeviceParam`.
            const quantiseEmit = (value: number): number =>
                deviceParameterLaw.quantiseValue({ deviceType: candidate.deviceType, paramId: parameterId, value });
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
                        slew: { ...deviceSlewGrid, clampStep, quantiseEmit },
                        activeWindowSeconds,
                        valueScale: laneScale,
                    }
                );
                binding.apply(segments);
                continue;
            }
            for (const { audioParam, scale, offset } of binding.targets) {
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
                        slew: { ...deviceSlewGrid, clampStep: clampScaledStep, quantiseEmit: quantiseScaledEmit },
                        activeWindowSeconds,
                        valueScale: laneScale * scale,
                        valueOffset: offset,
                    }
                );
            }
        }
    }
}
