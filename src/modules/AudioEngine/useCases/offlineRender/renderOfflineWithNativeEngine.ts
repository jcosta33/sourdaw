/**
 * The desktop export through the native engine (#2225, D3.c.2).
 *
 * Builds the same render the Web Audio path builds — strips, routing, sends,
 * automation and clip playbacks — as `AudioGraphCommand` batches, applies them
 * through `createNativeOfflineGraphBackend`, and renders through
 * `render_graph_offline`. Every law-bearing derivation is the web path's own
 * code, not a mirror of it: comping through `resolveTrackClipsWithComping`,
 * clip projection through `projectOfflineAudioClipPlaybacks`, automation
 * through `scheduleTrackAutomation` against a recording parameter
 * (`createAutomationRecorder` → `convertRecordedAutomationEvents`), routing
 * through `resolveOutputTarget`.
 *
 * ── Decline versus fail ───────────────────────────────────────────────────
 *
 * A *refused batch* — the native side's own vocabulary for "I cannot render
 * this" (a queue past capacity, a state its strip cannot hold) — declines the
 * attempt: the caller falls back to the Web Audio render, observably, and the
 * user still gets the correct file.
 *
 * The phase decides what a *throw* does, because the backend's two halves
 * treat one differently:
 *
 *   - **Apply phase.** `createNativeOfflineGraphBackend.apply` catches the
 *     transport and answers `rejected` with the error's message, so a wire
 *     failure while building the graph reaches this file as a refusal and
 *     declines like any other. That is deliberate and it stays observable:
 *     nothing is rendered yet, the reason travels with the decline, and the
 *     caller names it on `onWarning`. Two seam *defects* are excluded from it
 *     and do throw — a prior that no longer replays, and a malformed wire
 *     result — because neither describes anything the incoming batch asked
 *     for.
 *   - **Render phase.** `backend.render` catches nothing. Every batch was
 *     accepted whole by then, so a failure there describes the render request
 *     or the runtime, and falling back would hide it behind a second render
 *     that silently succeeded.
 *
 * Cancellation (`checkCancel`) propagates from either phase — a cancelled
 * export must not fall back into a second, uncancelled render.
 *
 * Warnings are buffered and flushed only when the native render is the one
 * delivered; a declined attempt discards them because the Web Audio path
 * re-derives its own from the same project truth, and the user would see each
 * one twice.
 */

import { type Track } from '#/modules/Arrangement/stores';
import { automationStore } from '#/modules/Automation/stores';
import { getAutomationLaneCeiling } from '#/modules/Automation/useCases';
import { defaultTransportState, type TempoMapStoreState, transportStore } from '#/modules/Transport/stores';
import { automationSlewTickSecondsForGrain } from '#/utils/automationSlew';

import {
    type AudioGraphClipFade,
    type AudioGraphCommand,
    type AudioGraphParameterWrite,
    type AudioGraphStripParameterTarget,
} from '../../models/AudioGraphBackend';
import { createNativeOfflineGraphBackend } from '../../repositories/nativeGraph/createNativeOfflineGraphBackend';
import { type NativeGraphTransport } from '../../repositories/nativeGraph/nativeGraphTransport';
import { scheduleTrackAutomation } from '../../repositories/offlineScheduler/automationScheduling';
import { type OfflinePpqEndpointProjector } from '../../repositories/offlineScheduler/offlinePpqEndpointProjectorState';
import { audioBufferCache } from '../../stores/audioBufferCache';
import { getCompensationDelay } from '../latencyCompensation/compensation/getCompensationDelay';

import { checkCancel } from './checkCancel';
import { MICRO_FADE_SECONDS } from './constants';
import { convertRecordedAutomationEvents } from './convertRecordedAutomationEvents';
import { createAutomationRecorder, type AutomationRecorder } from './createAutomationRecorder';
import { projectOfflineAudioClipPlaybacks } from './projectOfflineAudioClipPlaybacks';
import { resolveOutputTarget } from './resolveOutputTarget';
import { resolveTrackClipsWithComping } from './resolveTrackClipsWithComping';

export type NativeOfflineRenderInput = Readonly<{
    transport: NativeGraphTransport;
    sampleRate: number;
    frameCount: number;
    durationSeconds: number;
    /**
     * The project master level, already bounded by the caller to the fader
     * law's own range — `0` up to `FADER_MAX_GAIN`, not `0…1`. The master fader
     * reaches the same `+6 dB` of headroom every other fader does, so a render
     * that re-clamped this at unity would print quieter than the mix it was
     * asked to bounce.
     */
    masterGainValue: number;
    defaultTempo: number;
    changes: TempoMapStoreState['changes'];
    projectPpqEndpoints: OfflinePpqEndpointProjector;
    /** Every strip this render builds, in project order. */
    renderableTracks: readonly Track[];
    /** The tracks whose programme reaches the mix — audible plus cue-send-only. */
    scheduledTracks: readonly Track[];
    scheduledTrackIds: ReadonlySet<string>;
    vcaMultiplierByTrackId: ReadonlyMap<string, number>;
    onWarning?: (message: string) => void;
    onProgress?: (fraction: number) => void;
}>;

export type NativeOfflineRenderResult =
    Readonly<{ outcome: 'rendered'; buffer: AudioBuffer }> | Readonly<{ outcome: 'declined'; reason: string }>;

type ProgrammeConversion =
    | Readonly<{ outcome: 'converted'; commands: readonly AudioGraphCommand[] }>
    | Readonly<{ outcome: 'declined'; reason: string }>;

function writeCommands(
    target: AudioGraphStripParameterTarget,
    writes: readonly AudioGraphParameterWrite[]
): AudioGraphCommand[] {
    return writes.map((write): AudioGraphCommand => ({ kind: 'write-parameter', target, write }));
}

/**
 * Fader node-domain back to the seam's stored linear amplitude.
 *
 * The scheduler recorded `clampFaderGain(converted * vcaMultiplier)`; the seam
 * wants the value **pre-clamp and pre-VCA**, because the backend folds the VCA
 * and applies the fader clamp itself (`AudioGraphStripParameterTarget`).
 * Dividing the multiplier back out is exact under the round trip: the backend
 * computes `clamp(seam * vca) = clamp(clamp(x * vca)) = clamp(x * vca)`, the
 * very value the web path wrote. A zero multiplier silences the strip whatever
 * the lane holds, so any finite seam value is faithful — `0` is used.
 */
function seamFaderValue(recorded: number, vcaMultiplier: number): number {
    return vcaMultiplier === 0 ? 0 : recorded / vcaMultiplier;
}

/** Pan node-domain (−1…1) back to the seam's −50…50 project scale. */
function seamPanValue(recorded: number): number {
    return recorded * 50;
}

function clipFade(input: {
    fadeIn?: Readonly<{ userEndSec?: number }>;
    fadeOut?: Readonly<{ userStartSec?: number }>;
}): AudioGraphClipFade {
    return {
        ...(input.fadeIn
            ? { fadeIn: input.fadeIn.userEndSec === undefined ? {} : { reachesFullAt: input.fadeIn.userEndSec } }
            : {}),
        ...(input.fadeOut
            ? { fadeOut: input.fadeOut.userStartSec === undefined ? {} : { beginsAt: input.fadeOut.userStartSec } }
            : {}),
        microFadeSeconds: MICRO_FADE_SECONDS,
    };
}

export async function renderOfflineWithNativeEngine(
    input: NativeOfflineRenderInput
): Promise<NativeOfflineRenderResult> {
    const {
        transport,
        sampleRate,
        frameCount,
        durationSeconds,
        masterGainValue,
        defaultTempo,
        changes,
        projectPpqEndpoints,
        renderableTracks,
        scheduledTracks,
        scheduledTrackIds,
        vcaMultiplierByTrackId,
        onWarning,
        onProgress,
    } = input;

    const bufferedWarnings: string[] = [];
    const warn = (message: string): void => {
        bufferedWarnings.push(message);
    };

    function projectBeatToSeconds(beat: number): number {
        return projectPpqEndpoints({
            startPpq: beat,
            endPpq: beat,
            defaultTempo,
            sampleRate,
            changes,
        }).startSeconds;
    }
    const regionStartBeat = 0;
    const regionStartSec = projectBeatToSeconds(regionStartBeat);

    const busIds = new Set(renderableTracks.filter((track) => track.kind === 'bus').map((track) => track.id));
    const trackIds = new Set(renderableTracks.filter((track) => track.kind !== 'bus').map((track) => track.id));

    // ── Strips, exactly as the web path seeds them ─────────────────────────
    const stripCommands = renderableTracks.map((track): AudioGraphCommand => {
        const state = {
            gain: track.gain,
            pan: track.pan,
            muted: track.muted,
            // The mixdown does not gate a soloed-off track's strip; it leaves
            // it out of `scheduledTracks` instead — the web path's law.
            soloGated: false,
            vcaMultiplier: vcaMultiplierByTrackId.get(track.id) ?? 1,
        };
        return track.kind === 'bus'
            ? {
                  kind: 'create-bus-strip',
                  busId: track.id,
                  name: track.name,
                  state,
                  devices: track.devices,
                  honorMuted: true,
                  contributesAudio: scheduledTrackIds.has(track.id),
              }
            : {
                  kind: 'create-track-strip',
                  trackId: track.id,
                  name: track.name,
                  state,
                  devices: track.devices,
                  honorMuted: true,
                  contributesAudio: scheduledTrackIds.has(track.id),
              };
    });

    // ── Routing, on the same precedence the web path decides it ───────────
    const routingCommands = renderableTracks.flatMap((track): AudioGraphCommand[] => [
        {
            kind: 'set-track-output',
            trackId: track.id,
            target: resolveOutputTarget({ outputId: track.outputId, busStripIds: busIds, trackStripIds: trackIds }),
        },
        // A send naming no built bus is dropped, exactly as the web backend
        // drops it — the audio path it would carry does not exist either way.
        ...track.sends
            .filter((send) => busIds.has(send.busId))
            .map((send): AudioGraphCommand => ({
                kind: 'add-send',
                trackId: track.id,
                busId: send.busId,
                tap: send.preFader ? 'pre-fader' : 'post-fader',
                level: send.level,
            })),
    ]);

    // ── Programme: automation writes and clip playbacks per scheduled track ─
    function buildTrackProgramme(track: Track): ProgrammeConversion {
        const commands: AudioGraphCommand[] = [];
        const compensationDelay = getCompensationDelay(track.id);
        const vcaMultiplier = vcaMultiplierByTrackId.get(track.id) ?? 1;

        // The same lane set, gate and grain the web scheduler reads
        // (`scheduleTrackClips`); the mixdown always includes mixer lanes.
        const trackReadsAutomation = track.automationMode !== 'off';
        if (trackReadsAutomation) {
            const clipBoundsById = new Map<string, { startBeat: number; endBeat: number }>();
            for (const clip of track.clips) {
                clipBoundsById.set(clip.id, { startBeat: clip.startBeat, endBeat: clip.endBeat });
            }
            const gainRecorder = createAutomationRecorder();
            const panRecorder = createAutomationRecorder();
            const sendRecorders: { busId: string; recorder: AutomationRecorder }[] = [];
            const sendAutomationParams = new Map<string, AudioParam>();
            for (const send of track.sends) {
                if (!busIds.has(send.busId)) {
                    continue;
                }
                const recorder = createAutomationRecorder();
                sendRecorders.push({ busId: send.busId, recorder });
                sendAutomationParams.set(`send:${send.busId}`, recorder.param);
            }

            scheduleTrackAutomation({
                lanes: automationStore.value?.lanes ?? [],
                trackId: track.id,
                trackGainNode: { gain: gainRecorder.param },
                trackPanNode: { pan: panRecorder.param },
                sendAutomationParams,
                // The content gate admits device-free tracks only, so a device
                // lane has nothing to resolve against — the same outcome the
                // web path reaches with an empty chain.
                deviceEntries: [],
                durationSeconds,
                defaultTempo,
                changes,
                slewTickSeconds: automationSlewTickSecondsForGrain(
                    transportStore.value?.scheduleGrainMs ?? defaultTransportState.scheduleGrainMs
                ),
                deviceParameterLaw: {
                    acceptsAutomation: () => false,
                    clampValue: ({ value }) => value,
                    quantiseValue: ({ value }) => value,
                },
                regionStartSeconds: regionStartSec,
                projectBeatToSeconds,
                sampleRate,
                compensationDelaySec: compensationDelay,
                clipBoundsById,
                vcaMultiplier,
                // The native fold shares this scheduler with the Web Audio
                // path, so it takes the same lane law rather than a second copy.
                resolveLaneCeiling: getAutomationLaneCeiling,
            });

            const conversions: {
                target: AudioGraphStripParameterTarget;
                recorder: AutomationRecorder;
                valueToSeam: (value: number) => number;
            }[] = [
                {
                    target: { kind: 'track-fader', trackId: track.id },
                    recorder: gainRecorder,
                    valueToSeam: (value) => seamFaderValue(value, vcaMultiplier),
                },
                {
                    target: { kind: 'track-pan', trackId: track.id },
                    recorder: panRecorder,
                    valueToSeam: seamPanValue,
                },
                ...sendRecorders.map(({ busId, recorder }) => ({
                    target: { kind: 'track-send-level', trackId: track.id, busId } as const,
                    recorder,
                    valueToSeam: (value: number) => value,
                })),
            ];
            for (const { target, recorder, valueToSeam } of conversions) {
                const converted = convertRecordedAutomationEvents({
                    events: recorder.events,
                    sampleRate,
                    valueToSeam,
                });
                if (converted.outcome === 'declined') {
                    return {
                        outcome: 'declined',
                        reason: `automation on track "${track.name}": ${converted.reason}`,
                    };
                }
                commands.push(...writeCommands(target, converted.writes));
            }
        }

        for (const clip of resolveTrackClipsWithComping(track.id, track.clips)) {
            if (clip.muted || clip.endBeat <= regionStartBeat) {
                continue;
            }
            if (clip.type !== 'audio') {
                // The engine selection gates instrument programme to the Web
                // Audio path; a MIDI clip reaching here means the gate and
                // this builder disagree, and the honest answer is the
                // fallback, not a silent drop.
                return { outcome: 'declined', reason: `MIDI clip on track "${track.name}" reached the native path` };
            }
            if (!clip.audioBufferId) {
                continue;
            }
            const buffer = audioBufferCache.get(clip.audioBufferId);
            if (!buffer) {
                warn(
                    `Audio clip "${clip.name}" is missing its audio buffer and will be silent in the export. ` +
                        `Try re-importing the file or reloading the project.`
                );
                continue;
            }
            if (clip.endBeat - clip.startBeat <= 0) {
                warn(
                    `Clip "${clip.name || clip.id}" on track "${track.name}" has zero or negative duration and was skipped.`
                );
                continue;
            }

            const playbacks = projectOfflineAudioClipPlaybacks({
                clip,
                bufferDurationSeconds: buffer.duration,
                regionStartBeat,
                regionStartSec,
                durationSeconds,
                compensationDelay,
                projectBeatToSeconds,
            });
            for (const playback of playbacks) {
                commands.push({
                    kind: 'schedule-clip',
                    playback: {
                        trackId: track.id,
                        source: { sourceId: clip.audioBufferId, buffer },
                        startTime: playback.startSec,
                        sourceOffsetSeconds: playback.bufferOffsetSec,
                        durationSeconds: playback.playDuration,
                        playbackRate: playback.playbackRate,
                        gain: playback.clipGainValue,
                        fade: clipFade(playback),
                    },
                });
            }
        }
        return { outcome: 'converted', commands };
    }

    const programmeCommands: AudioGraphCommand[] = [];
    for (const track of scheduledTracks) {
        const programme = buildTrackProgramme(track);
        if (programme.outcome === 'declined') {
            return programme;
        }
        programmeCommands.push(...programme.commands);
    }

    // ── Apply and render ───────────────────────────────────────────────────
    const backend = createNativeOfflineGraphBackend({ sampleRate, transport });
    try {
        const batches: { commands: readonly AudioGraphCommand[]; attempt: string }[] = [
            { commands: stripCommands, attempt: 'build the strips' },
            { commands: routingCommands, attempt: 'route the outputs and sends' },
            { commands: programmeCommands, attempt: 'schedule the programme' },
        ];
        for (const { commands, attempt } of batches) {
            checkCancel();
            if (commands.length === 0) {
                continue;
            }
            const result = await backend.apply({ schemaVersion: 1, commands });
            if (result.application !== 'applied') {
                const reason = result.acceptance === 'rejected' ? result.reason : result.application;
                return { outcome: 'declined', reason: `the native engine refused to ${attempt}: ${reason}` };
            }
        }
        checkCancel();
        onProgress?.(0.5);

        const { left, right } = await backend.render(frameCount);
        checkCancel();
        // The master level is the web path's `masterGain` node, applied here
        // in the one place the native render's output crosses back.
        if (masterGainValue !== 1) {
            for (let frame = 0; frame < left.length; frame++) {
                left[frame] = left[frame]! * masterGainValue;
                right[frame] = right[frame]! * masterGainValue;
            }
        }
        const buffer = new AudioBuffer({ length: frameCount, numberOfChannels: 2, sampleRate });
        buffer.copyToChannel(left, 0);
        buffer.copyToChannel(right, 1);
        for (const message of bufferedWarnings) {
            onWarning?.(message);
        }
        return { outcome: 'rendered', buffer };
    } finally {
        backend.dispose();
    }
}
