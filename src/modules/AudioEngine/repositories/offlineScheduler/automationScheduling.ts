import { clampFaderGain, dbToGain } from '#/utils/audioLevelLaw';
import { getDeviceAutomationParameterId, resolveDeviceAutomationTargetIndex } from '#/utils/automationDeviceTarget';
import { resolveLinkedLane } from '#/utils/automationLaneLink';
import { AUTOMATION_SLEW_ALPHA, AUTOMATION_SLEW_TICK_SECONDS } from '#/utils/automationSlew';

import { type AutomationLane } from '../../models/AutomationViewTypes';
import { beatToSeconds } from '../../services/beatConversion';
import { type AudioDeviceStrategy } from '../deviceStrategy/AudioDeviceStrategy';

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

function acceptsOfflineAutomationParameter(
    candidate: ScheduleTrackAutomationDeviceEntry,
    parameterId: string
): boolean {
    return candidate.strategy.resolveOfflineAutomation(parameterId) !== null;
}

export function scheduleTrackAutomation(
    lanes: AutomationLane[],
    trackId: string,
    trackGainNode: GainNode,
    trackPanNode: StereoPannerNode,
    deviceEntries: ScheduleTrackAutomationDeviceEntry[],
    durationSeconds: number,
    defaultTempo: number,
    changes: AutomationTempoChange[],
    regionStartSeconds = 0,
    projectBeatToSeconds?: (beat: number) => number,
    sampleRate = 44_100,
    compensationDelaySec = 0,
    clipBoundsById?: Map<string, { startBeat: number; endBeat: number }>,
    /**
     * The track's VCA group master as a plain multiplier (`1` outside a group).
     * Resolved by the calling render use case and passed in, because this
     * repository must not reach into Arrangement's VCA read model itself.
     */
    vcaMultiplier = 1
): void {
    const projectBeat = projectBeatToSeconds ?? ((beat) => beatToSeconds(beat, defaultTempo, changes));
    const laneById = new Map<string, AutomationLane>();
    for (const lane of lanes) {
        laneById.set(lane.id, lane);
    }
    // AU-2: device/MIDI-FX params carry the live control slew; gain/pan do not.
    const deviceSlew = { alpha: AUTOMATION_SLEW_ALPHA, tickSeconds: AUTOMATION_SLEW_TICK_SECONDS };

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

        const deviceIndex = resolveDeviceAutomationTargetIndex(
            lane.parameterId,
            deviceEntries,
            acceptsOfflineAutomationParameter
        );
        const parameterId = getDeviceAutomationParameterId(lane.parameterId);
        if (deviceIndex >= 0 && parameterId) {
            const candidate = deviceEntries[deviceIndex]!;
            const binding = candidate.strategy.resolveOfflineAutomation(parameterId);
            if (!binding) {
                continue;
            }
            if (binding.kind === 'segments') {
                const segments = compileAutomationSegments(
                    points,
                    durationSeconds,
                    defaultTempo,
                    changes,
                    sampleRate,
                    regionStartSeconds,
                    projectBeatToSeconds,
                    { slew: deviceSlew, activeWindowSeconds, valueScale: laneScale }
                );
                binding.apply(segments);
                continue;
            }
            for (const { audioParam, scale, offset } of binding.targets) {
                // Compose linkScale with the device binding's unit scale/offset as
                // one affine post-transform: paramValue = interpolate(source) *
                // (linkScale * scale) + offset — evaluated on the unscaled source
                // curve (AU-3), never a pre-scale of point.value.
                scheduleAutomationOnParam(
                    audioParam,
                    points,
                    durationSeconds,
                    defaultTempo,
                    changes,
                    regionStartSeconds,
                    projectBeatToSeconds,
                    compensationDelaySec,
                    { slew: deviceSlew, activeWindowSeconds, valueScale: laneScale * scale, valueOffset: offset }
                );
            }
        }
    }
}
