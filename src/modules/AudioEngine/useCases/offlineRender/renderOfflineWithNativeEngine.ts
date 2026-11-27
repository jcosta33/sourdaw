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
 * ── Device parameter automation ───────────────────────────────────────────
 *
 * The engine selection admits only chains of native built-in bodies and loaded
 * hosted plugins (`nativeOfflineHostedDevice`, #4592, #6777), and their
 * parameter lanes ride `write-device-parameter` under exactly the law and the
 * names the live writer stamps them with: `nativeBuiltinAutomation` for a
 * built-in (#3776), the instance's own published law for a hosted plugin, both
 * through `nativeDeviceParameterLaw`. A hosted plugin sits on its strip with
 * its `externalInstanceId`, and the engine prints it through an offline
 * instance of its own, built from the live instance's state and compensated
 * by the engine against the instance's own latency.
 *
 * A loaded hosted instrument's notes ride `schedule-midi`; `readNativeOfflineMidiSource`
 * documents their law.
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
 *     that silently succeeded. The one exception is a trimmed render whose
 *     compensation head takes it past the engine's frame ceiling
 *     (`offline-render-head-past-ceiling`): the selection gate cannot see
 *     that head, which includes hosted plugin latency, so the refusal
 *     declines exactly as the gate would have.
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
 * export must not fall back into a second, uncancelled render. While the
 * render itself is in flight the abort signal reaches the native side through
 * the backend, which cancels the render it named; the native refusal that
 * follows reaches the caller as the same `Export cancelled` error.
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

import { getAudioDeviceRuntimeSink } from '../../engine/audioDeviceRuntimeSink';
import {
    type AudioGraphAddSendCommand,
    type AudioGraphCommand,
    type AudioGraphParameterTarget,
    type AudioGraphParameterWrite,
} from '../../models/AudioGraphBackend';
import { STEREO_CHANNEL_COUNT } from '../../models/ChannelLaw';
import { createNativeOfflineGraphBackend } from '../../repositories/nativeGraph/createNativeOfflineGraphBackend';
import { type PlanarStereo } from '../../repositories/nativeGraph/deinterleaveStereoPcm';
import { type NativeGraphTransport } from '../../repositories/nativeGraph/nativeGraphTransport';
import { offlineDeviceParameterLawState } from '../../repositories/offlineScheduler/offlineDeviceParameterLawState';
import {
    type OfflinePpqEndpointProjector,
    type OfflineTempoAtBeatResolver,
} from '../../repositories/offlineScheduler/offlinePpqEndpointProjectorState';
import { audioBufferCache } from '../../stores/audioBufferCache';
import { getCompensationDelay } from '../latencyCompensation/compensation/getCompensationDelay';
import { nativeBuiltinAutomation } from '../livePlayback/nativeBuiltinAutomation';
import { nativeDeviceParameterLaw } from '../livePlayback/nativeDeviceParameterLaw';
// Project truth spells a built-in's parameters as the ids a panel authors; the
// native mapper resolves them against the engine's own vocabulary and refuses
// the whole batch, by strip, over one it cannot name (#3893).
import { projectDeviceForNativeBody } from '../livePlayback/projectDeviceForNativeBody';

import { admitNativeClipExpansion, MAX_NATIVE_TRACK_CLIPS } from './admitNativeClipExpansion';
import { answerNativeRenderFailure } from './answerNativeRenderFailure';
import { automationWriteCommand } from './automationWriteCommand';
import { type captureOfflineRenderInput } from './captureOfflineRenderInput';
import { checkCancel } from './checkCancel';
import { deviceParameterOverlapReason } from './deviceParameterOverlapReason';
import { nativeEngineHostedStripIds } from './nativeEngineHostedStripIds';
import { nativeOfflineDeviceEntries } from './nativeOfflineDeviceEntries';
import { type NativeOfflineHostedRuntime } from './nativeOfflineHostedDevice';
import { nativeOfflineInstrumentSink } from './nativeOfflineInstrumentSink';
import { nativeRefusedDeviceLane } from './nativeRefusedDeviceLane';
import { projectNativeClipFade } from './projectNativeClipFade';
import { projectNativeOfflineMidiCommands } from './projectNativeOfflineMidiCommands';
import { projectOfflineAudioClipPlaybacks } from './projectOfflineAudioClipPlaybacks';
import { projectStripAutomationWrites } from './projectStripAutomationWrites';
import { readNativeOfflineHostedRuntime } from './readNativeOfflineHostedRuntime';
import { readNativeOfflineMidiSource } from './readNativeOfflineMidiSource';
import { renderTempoTimeline } from './renderTempoTimeline';
import { resolveOutputTarget } from './resolveOutputTarget';
import { resolveTrackClipsWithComping } from './resolveTrackClipsWithComping';

export type NativeOfflineRenderInput = Readonly<{
    captured?: ReturnType<typeof captureOfflineRenderInput>;
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
    /**
     * The strips whose device-chain output can reach what this render prints,
     * by the shared print-reachability computation (#4376). A strip outside it
     * contributes silence, so a device the native mapper cannot hold degrades
     * there instead of refusing the whole export.
     */
    contributingTrackIds: ReadonlySet<string>;
    soloGatedByTrackId: ReadonlyMap<string, boolean>;
    vcaMultiplierByTrackId: ReadonlyMap<string, number>;
    onWarning?: (message: string) => void;
    onProgress?: (fraction: number) => void;
    /** Stops this render alone, without the process-wide export cancel flag. */
    abortSignal?: AbortSignal;
    /**
     * The loaded hosted instances and their kinds the engine selection read —
     * the same value, so the two halves of the render admit one set. Absent,
     * read live.
     */
    hostedPluginRuntime?: NativeOfflineHostedRuntime;
    /**
     * Have the engine render the depth it holds the master to (read from its
     * graph, hosted plugin latency included) ahead of `frameCount` and drop it.
     */
    printsCompensationHead?: boolean;
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
 * The native render's output as the export's buffer. The master level is the web path's
 * `masterGain` node, applied here in the one place the native render's output crosses back.
 */
function printedStereoBuffer(
    { left, right }: PlanarStereo,
    {
        frameCount,
        sampleRate,
        masterGainValue,
    }: Readonly<{ frameCount: number; sampleRate: number; masterGainValue: number }>
): AudioBuffer {
    if (masterGainValue !== 1) {
        for (let frame = 0; frame < left.length; frame++) {
            left[frame] = left[frame]! * masterGainValue;
            right[frame] = right[frame]! * masterGainValue;
        }
    }
    const buffer = new AudioBuffer({ length: frameCount, numberOfChannels: STEREO_CHANNEL_COUNT, sampleRate });
    buffer.copyToChannel(left, 0);
    buffer.copyToChannel(right, 1);
    return buffer;
}

/**
 * The sends the native graph has a path for, from a track or a bus alike — the
 * same admission as live `sendCommands` in `projectLiveGraphTopology`: no send
 * naming a bus this render did not build, which the Web Audio render does not
 * wire either.
 */
function sendCommands(input: { track: Track; busStripIds: ReadonlySet<string> }): AudioGraphAddSendCommand[] {
    const { track, busStripIds } = input;
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

type ResolvedClip = ReturnType<typeof resolveTrackClipsWithComping>[number];
type PlayableClipSource = { sourceId: string; buffer: AudioBuffer };

function scheduleClipCommand(
    trackId: string,
    source: PlayableClipSource,
    playback: ReturnType<typeof projectOfflineAudioClipPlaybacks>[number]
): AudioGraphCommand {
    return {
        kind: 'schedule-clip',
        playback: {
            trackId,
            source,
            startTime: playback.startSec,
            sourceOffsetSeconds: playback.bufferOffsetSec,
            durationSeconds: playback.playDuration,
            playbackRate: playback.playbackRate,
            gain: playback.clipGainValue,
            fade: projectNativeClipFade(playback),
        },
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
        resolveTempoAtBeat,
        renderableTracks,
        scheduledTracks,
        contributingTrackIds,
        soloGatedByTrackId,
        vcaMultiplierByTrackId,
        onWarning,
        onProgress,
        abortSignal,
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
    const engineHostedStripIds = nativeEngineHostedStripIds(renderableTracks);

    // The same lanes and the same declared law the web render reads, bound to
    // the built-in half the live writer stamps under.
    const automationLanes = input.captured?.scheduling.automationLanes ?? automationStore.value?.lanes ?? [];
    const lawSource = input.captured?.scheduling.deviceParameterLaw ?? offlineDeviceParameterLawState;
    const builtinAutomation = nativeBuiltinAutomation({ source: lawSource, stripTracks: renderableTracks });
    const { law: deviceParameterLaw } = nativeDeviceParameterLaw({
        source: lawSource,
        stripTracks: renderableTracks,
        builtin: builtinAutomation.law,
    });
    const hostedRuntime =
        input.hostedPluginRuntime ?? readNativeOfflineHostedRuntime(input.captured?.loadedExternalInstanceIds);

    // ── Strips, exactly as the web path seeds them ─────────────────────────
    const stripCommands = renderableTracks.map((track): AudioGraphCommand => {
        const state = {
            gain: track.gain,
            pan: track.pan,
            muted: track.muted,
            soloGated: soloGatedByTrackId.get(track.id) ?? false,
            vcaMultiplier: vcaMultiplierByTrackId.get(track.id) ?? 1,
        };
        const devices = track.devices.map((device) =>
            input.captured
                ? (input.captured.nativeDevices.get(device.id) ?? device)
                : projectDeviceForNativeBody(device)
        );
        return track.kind === 'bus'
            ? {
                  kind: 'create-bus-strip',
                  busId: track.id,
                  name: track.name,
                  state,
                  devices,
                  honorMuted: true,
                  contributesAudio: contributingTrackIds.has(track.id),
              }
            : {
                  kind: 'create-track-strip',
                  trackId: track.id,
                  name: track.name,
                  state,
                  devices,
                  honorMuted: true,
                  contributesAudio: contributingTrackIds.has(track.id),
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
    // The decoded audio an audio clip plays, or `null` (warned) when it has none worth scheduling.
    function readPlayableClipBuffer(track: Track, clip: ResolvedClip): PlayableClipSource | null {
        if (!clip.audioBufferId) {
            return null;
        }
        const buffer = (input.captured?.scheduling.buffers ?? audioBufferCache).get(clip.audioBufferId);
        if (!buffer) {
            warn(
                `Audio clip "${clip.name}" is missing its audio buffer and will be silent in the export. ` +
                    `Try re-importing the file or reloading the project.`
            );
            return null;
        }
        if (clip.endBeat - clip.startBeat <= 0) {
            warn(
                `Clip "${clip.name || clip.id}" on track "${track.name}" has zero or negative duration and was skipped.`
            );
            return null;
        }
        return { sourceId: clip.audioBufferId, buffer };
    }

    // A loaded hosted instrument is voiced by the engine: its notes ride
    // `schedule-midi` against the device, after the strip that holds it
    // (the strips are their own, earlier batch). A strip no audible output
    // reaches holds no device to address, and nothing would hear it.
    function buildInstrumentProgramme(track: Track, compensationDelay: number): ProgrammeConversion {
        if (!contributingTrackIds.has(track.id) || nativeOfflineInstrumentSink(track, hostedRuntime) === null) {
            return { outcome: 'converted', commands: [] };
        }
        const source = readNativeOfflineMidiSource(
            input.captured,
            { sampleRate, defaultTempo, changes, projectPpqEndpoints },
            renderTempoTimeline(projectBeatToSeconds, resolveClipTempo)
        );
        if (source === null) {
            return { outcome: 'declined', reason: 'the MIDI projection is not configured for the native render' };
        }
        return {
            outcome: 'converted',
            commands: projectNativeOfflineMidiCommands({
                track,
                hostedRuntime,
                source,
                durationSeconds: frameCount / sampleRate,
                compensationDelaySeconds: compensationDelay,
            }),
        };
    }

    function buildTrackProgramme(track: Track): ProgrammeConversion {
        const commands: AudioGraphCommand[] = [];
        const compensationDelay = input.captured
            ? getCompensationDelay(track.id, undefined, engineHostedStripIds, input.captured.scheduling.latency)
            : getCompensationDelay(track.id, undefined, engineHostedStripIds);
        const vcaMultiplier = vcaMultiplierByTrackId.get(track.id) ?? 1;

        const deviceEntries = nativeOfflineDeviceEntries(track, hostedRuntime);
        const refusedLane = nativeRefusedDeviceLane({
            track,
            lanes: automationLanes,
            deviceEntries,
            law: deviceParameterLaw,
        });
        if (refusedLane !== null) {
            return {
                outcome: 'declined',
                reason:
                    `automation lane "${refusedLane.parameterName}" on track "${track.name}" names a device ` +
                    `parameter the native render cannot carry`,
            };
        }

        // The same lane set, gate and grain the web scheduler reads
        // (`scheduleTrackClips`); the mixdown always includes mixer lanes.
        // `projectStripAutomationWrites` shares this projection with the live
        // producer — see that module's header for the recorder/convert
        // relationship this used to inline here.
        const automation = projectStripAutomationWrites({
            track,
            admittedSendBusIds: sendCommands({ track, busStripIds: busIds }).map((command) => command.busId),
            lanes: automationLanes,
            regionStartSeconds: regionStartSec,
            durationSeconds,
            changes,
            projectBeatToSeconds,
            sampleRate,
            compensationDelaySec: compensationDelay,
            vcaMultiplier,
            slewTickSeconds: automationSlewTickSecondsForGrain(
                input.captured?.scheduling.scheduleGrainMs ??
                    transportStore.value?.scheduleGrainMs ??
                    defaultTransportState.scheduleGrainMs
            ),
            // The native fold shares this scheduler with the Web Audio path,
            // so it takes the same lane law rather than a second copy.
            resolveLaneCeiling: getAutomationLaneCeiling,
            deviceEntries,
            deviceParameterLaw,
        });
        if (automation.outcome === 'declined') {
            return automation;
        }
        // This export has no lane order to fall back on the way the live
        // producer does — one merged schedule per parameter is the only
        // shape it carries — so an overlap it cannot merge still declines
        // the whole render rather than printing a file missing a clash the
        // musician would hear.
        if (automation.overlaps.length > 0) {
            return { outcome: 'declined', reason: deviceParameterOverlapReason(track.name, automation.overlaps[0]!) };
        }
        for (const { target, writes } of automation.entries.map(builtinAutomation.addressNatively)) {
            commands.push(...writeCommands(target, writes));
        }

        const instrumentProgramme = buildInstrumentProgramme(track, compensationDelay);
        if (instrumentProgramme.outcome === 'declined') {
            return instrumentProgramme;
        }
        commands.push(...instrumentProgramme.commands);

        // What the native strip has left to hold, counted down across the
        // track's clips — the same countdown the live producer runs, because
        // the two schedule the same expansion into the same ceiling.
        let remainingClipSlots = MAX_NATIVE_TRACK_CLIPS;
        const voicedByInstrument = nativeOfflineInstrumentSink(track, hostedRuntime) !== null;

        const tempoTimeline = renderTempoTimeline(projectBeatToSeconds, resolveClipTempo);
        for (const clip of resolveTrackClipsWithComping(
            track.id,
            track.clips,
            input.captured?.scheduling.takeLanes,
            tempoTimeline
        )) {
            if (clip.muted || clip.endBeat <= regionStartBeat) {
                continue;
            }
            if (clip.type === 'midi' && voicedByInstrument) {
                // Voiced through `schedule-midi` above.
                continue;
            }
            if (clip.type !== 'audio') {
                // The engine selection gates every other instrument's
                // programme to the Web Audio path; a MIDI clip reaching here
                // means the gate and this builder disagree, and the honest
                // answer is the fallback, not a silent drop.
                return { outcome: 'declined', reason: `MIDI clip on track "${track.name}" reached the native path` };
            }
            const source = readPlayableClipBuffer(track, clip);
            if (source === null) {
                continue;
            }

            const playbacks = projectOfflineAudioClipPlaybacks({
                clip,
                bufferDurationSeconds: source.buffer.duration,
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

            commands.push(...playbacks.map((playback) => scheduleClipCommand(track.id, source, playback)));
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
    const backend = createNativeOfflineGraphBackend({
        sampleRate,
        transport,
        // The bounce stages the same banks the live session does, through the
        // same sink: an export of a carried Levain strip must sound the
        // instrument the musician heard, not a strip the mapper refused.
        acquireNativeSampleBank:
            input.captured?.acquireNativeSampleBank ?? getAudioDeviceRuntimeSink().acquireNativeSampleBank,
    });
    try {
        const batches: { commands: readonly AudioGraphCommand[]; attempt: string }[] = [
            { commands: stripCommands, attempt: 'build the strips' },
            { commands: routingCommands, attempt: 'route the outputs and sends' },
            { commands: programmeCommands, attempt: 'schedule the programme' },
        ];
        for (const { commands, attempt } of batches) {
            checkCancel(abortSignal);
            if (commands.length === 0) {
                continue;
            }
            const result = await backend.apply({ schemaVersion: 1, commands });
            if (result.application !== 'applied') {
                const reason = result.acceptance === 'rejected' ? result.reason : result.application;
                return { outcome: 'declined', reason: `the native engine refused to ${attempt}: ${reason}` };
            }
        }
        checkCancel(abortSignal);
        onProgress?.(0.5);

        let rendered: PlanarStereo;
        try {
            rendered = await backend.render(frameCount, {
                abortSignal,
                printsCompensationHead: input.printsCompensationHead === true,
            });
        } catch (error: unknown) {
            return answerNativeRenderFailure(error, abortSignal);
        }
        checkCancel(abortSignal);
        const buffer = printedStereoBuffer(rendered, { frameCount, sampleRate, masterGainValue });
        for (const message of bufferedWarnings) {
            onWarning?.(message);
        }
        return { outcome: 'rendered', buffer };
    } finally {
        backend.dispose();
    }
}
