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
 * A clip whose loop expansion is past the strip's remaining native clip
 * capacity is a third case, and it is neither: `admitNativeClipExpansion`
 * leaves it out and warns, the same verdict on the same numbers that
 * `projectLiveGraphProgramme` reaches for the live session. Declining instead
 * would be defensible on its own, but the two paths are meant to be one render,
 * and a ceiling only the export honours is a bounce that does not match what
 * the engineer heard.
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
    type AudioGraphAddSendCommand,
    type AudioGraphCommand,
    type AudioGraphParameterTarget,
    type AudioGraphParameterWrite,
} from '../../models/AudioGraphBackend';
import { createNativeOfflineGraphBackend } from '../../repositories/nativeGraph/createNativeOfflineGraphBackend';
import { type NativeGraphTransport } from '../../repositories/nativeGraph/nativeGraphTransport';
import {
    type OfflinePpqEndpointProjector,
    type OfflineTempoAtBeatResolver,
} from '../../repositories/offlineScheduler/offlinePpqEndpointProjectorState';
import { audioBufferCache } from '../../stores/audioBufferCache';
import { getCompensationDelay } from '../latencyCompensation/compensation/getCompensationDelay';
// Project truth spells a built-in's parameters as the ids a panel authors; the
// native mapper resolves them against the engine's own vocabulary and refuses
// the whole batch, by strip, over one it cannot name (#3893).
import { projectDeviceForNativeBody } from '../livePlayback/projectDeviceForNativeBody';

import { admitNativeClipExpansion, MAX_NATIVE_TRACK_CLIPS } from './admitNativeClipExpansion';
import { automationWriteCommand } from './automationWriteCommand';
import { checkCancel } from './checkCancel';
import { projectNativeClipFade } from './projectNativeClipFade';
import { projectOfflineAudioClipPlaybacks } from './projectOfflineAudioClipPlaybacks';
import { projectStripAutomationWrites } from './projectStripAutomationWrites';
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
    /**
     * Flat tempo at a beat — what a clip's buffer-content offset converts
     * through. Required for the same reason the web path requires it: a
     * default-tempo fallback seeks to the wrong point in the source for every
     * project carrying a tempo map, inaudibly until someone listens.
     */
    resolveTempoAtBeat: OfflineTempoAtBeatResolver;
    /** Every strip this render builds, in project order. */
    renderableTracks: readonly Track[];
    /** The tracks whose programme reaches the mix — audible plus cue-send-only. */
    scheduledTracks: readonly Track[];
    scheduledTrackIds: ReadonlySet<string>;
    soloGatedByTrackId: ReadonlyMap<string, boolean>;
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
    target: AudioGraphParameterTarget,
    writes: readonly AudioGraphParameterWrite[]
): AudioGraphCommand[] {
    return writes.map((write) => automationWriteCommand(target, write));
}

/**
 * The sends the native graph has a path for — the same drop as live
 * `sendCommands` in `projectLiveGraphTopology`: no `add-send` from a bus, and
 * no send naming a bus this render did not build.
 */
function sendCommands(input: { track: Track; busStripIds: ReadonlySet<string> }): AudioGraphAddSendCommand[] {
    const { track, busStripIds } = input;
    if (track.kind === 'bus') {
        return [];
    }
    return track.sends
        .filter((send) => busStripIds.has(send.busId))
        .map((send): AudioGraphAddSendCommand => ({
            kind: 'add-send',
            trackId: track.id,
            busId: send.busId,
            tap: send.preFader ? 'pre-fader' : 'post-fader',
            level: send.level,
        }));
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
        resolveTempoAtBeat,
        renderableTracks,
        scheduledTracks,
        scheduledTrackIds,
        soloGatedByTrackId,
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
    // The flat rate at a beat, not the integrated map — the web path's law for a
    // clip's source-content offset, applied identically here.
    function resolveClipTempo(beat: number): number {
        return resolveTempoAtBeat({ changes, beat, defaultTempo });
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
            soloGated: soloGatedByTrackId.get(track.id) ?? false,
            vcaMultiplier: vcaMultiplierByTrackId.get(track.id) ?? 1,
        };
        const devices = track.devices.map(projectDeviceForNativeBody);
        return track.kind === 'bus'
            ? {
                  kind: 'create-bus-strip',
                  busId: track.id,
                  name: track.name,
                  state,
                  devices,
                  honorMuted: true,
                  contributesAudio: scheduledTrackIds.has(track.id),
              }
            : {
                  kind: 'create-track-strip',
                  trackId: track.id,
                  name: track.name,
                  state,
                  devices,
                  honorMuted: true,
                  contributesAudio: scheduledTrackIds.has(track.id),
              };
    });

    // ── Routing, on the same precedence the web path decides it ───────────
    const routingCommands = renderableTracks.flatMap((track): AudioGraphCommand[] => [
        {
            kind: 'set-track-output',
            trackId: track.id,
            target: resolveOutputTarget({
                outputId: track.outputId,
                busStripIds: busIds,
                trackStripIds: trackIds,
            }),
        },
        ...sendCommands({ track, busStripIds: busIds }),
    ]);

    // ── Programme: automation writes and clip playbacks per scheduled track ─
    function buildTrackProgramme(track: Track): ProgrammeConversion {
        const commands: AudioGraphCommand[] = [];
        const compensationDelay = getCompensationDelay(track.id);
        const vcaMultiplier = vcaMultiplierByTrackId.get(track.id) ?? 1;

        // The same lane set, gate and grain the web scheduler reads
        // (`scheduleTrackClips`); the mixdown always includes mixer lanes.
        // `projectStripAutomationWrites` shares this projection with the live
        // producer — see that module's header for the recorder/convert
        // relationship this used to inline here.
        const automation = projectStripAutomationWrites({
            track,
            admittedSendBusIds: sendCommands({ track, busStripIds: busIds }).map((command) => command.busId),
            lanes: automationStore.value?.lanes ?? [],
            regionStartSeconds: regionStartSec,
            durationSeconds,
            defaultTempo,
            changes,
            projectBeatToSeconds,
            sampleRate,
            compensationDelaySec: compensationDelay,
            vcaMultiplier,
            slewTickSeconds: automationSlewTickSecondsForGrain(
                transportStore.value?.scheduleGrainMs ?? defaultTransportState.scheduleGrainMs
            ),
            // The native fold shares this scheduler with the Web Audio path,
            // so it takes the same lane law rather than a second copy.
            resolveLaneCeiling: getAutomationLaneCeiling,
        });
        if (automation.outcome === 'declined') {
            return automation;
        }
        for (const { target, writes } of automation.entries) {
            commands.push(...writeCommands(target, writes));
        }

        // What the native strip has left to hold, counted down across the
        // track's clips — the same countdown the live producer runs, because
        // the two schedule the same expansion into the same ceiling.
        let remainingClipSlots = MAX_NATIVE_TRACK_CLIPS;

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
                resolveTempoAtBeat: resolveClipTempo,
            });
            const expansion = admitNativeClipExpansion({ iterations: playbacks.length, remainingClipSlots });
            if (!expansion.admitted) {
                warn(
                    `Clip "${clip.name || clip.id}" on track "${track.name}" was left out of the export because ` +
                        `${expansion.reason}.`
                );
                continue;
            }
            remainingClipSlots -= playbacks.length;

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
                        fade: projectNativeClipFade(playback),
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
