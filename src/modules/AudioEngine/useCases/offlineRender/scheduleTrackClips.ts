import { takeLaneStore, type Track } from '#/modules/Arrangement/stores';
import { automationStore } from '#/modules/Automation/stores';
import { type MidiStoreState } from '#/modules/MIDI/stores';
import {
    getDrumKitDefByIndex,
    getSynthParamsFromDevices,
    scheduleDrumKitNote,
    scheduleKitNote,
    scheduleNoteOffline,
} from '#/modules/Synth/useCases';
import { defaultTransportState, type TempoMapStoreState, transportStore } from '#/modules/Transport/stores';
import { automationSlewTickSecondsForGrain } from '#/utils/automationSlew';
// Not `#/modules/Arrangement/useCases`. This file is the single edge that decides whether the
// 43-module knot (Arrangement, Transport, Collaboration, CrdtDocument, Yeast, MIDI, AudioEngine, …)
// is a cycle: importing that barrel here reds `deps:validate` with ~200 no-circular rows.
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';
import { resolveToasterPadIndex, TOASTER_NEUTRAL_MIDI_NOTE } from '#/utils/toasterNoteProjection';
import { getToasterSwingOffsetBeats } from '#/utils/toasterSwingProjection';

import { scheduleTrackAutomation } from '../../repositories/offlineScheduler/automationScheduling';
import { offlineDeviceParameterLawState } from '../../repositories/offlineScheduler/offlineDeviceParameterLawState';
import {
    type OfflineMidiEventProjector,
    type OfflineMidiArticulationResolver,
    type OfflineAutomationValueEvaluator,
    type OfflineChordPitchProjector,
    type OfflineMidiProbabilitySelector,
} from '../../repositories/offlineScheduler/offlineMidiEventProjectorState';
import { type OfflinePpqEndpointProjector } from '../../repositories/offlineScheduler/offlinePpqEndpointProjectorState';
import { type OfflineYeastMidiProcessor } from '../../repositories/offlineScheduler/offlineYeastMidiProcessorState';
import { resolveDrumKit } from '../../services/deviceResolution';
import { audioBufferCache } from '../../stores/audioBufferCache';
import { type DeviceNodeEntry, buildDeviceChain } from '../buildDeviceChain';
import { getCompensationDelay } from '../latencyCompensation/compensation/getCompensationDelay';
import { getDefaultBendRangeSemitones } from '../noteExpression/getDefaultBendRangeSemitones';

import { checkCancel } from './checkCancel';
import { MICRO_FADE_SECONDS, MIXER_AUTOMATION_PARAMETER_IDS, YIELD_EVERY_N_NOTES } from './constants';
import { projectOfflineYeastTrackNotes } from './projectOfflineYeastTrackNotes';
import { scheduleOfflineClipSource } from './scheduleOfflineClipSource';
import { type OfflineScheduleTally, type PendingWorkletEvent } from './types';
import { yieldToMain } from './yieldToMain';

type ResolvedClip = Track['clips'][number] & {
    regionStartBeat: number;
    regionEndBeat: number;
    sourceStartBeat: number;
};

type GetSourceOccurrenceOffsetInput = {
    sourceStartBeat: number;
    segmentStartBeat: number;
    loopLength: number;
    loopEnabled: boolean;
};

function getSourceOccurrenceOffset({
    sourceStartBeat,
    segmentStartBeat,
    loopLength,
    loopEnabled,
}: GetSourceOccurrenceOffsetInput): number {
    if (!loopEnabled || loopLength <= 0) {
        return 0;
    }

    const beatsFromSourceStart = segmentStartBeat - sourceStartBeat;
    if (beatsFromSourceStart <= 0) {
        return 0;
    }

    return Math.floor(beatsFromSourceStart / loopLength);
}

function resolveTrackClipsWithComping(trackId: string, clips: Track['clips']): ResolvedClip[] {
    const laneState = takeLaneStore.value;
    if (!laneState) {
        return clips.map((clip) => ({
            ...clip,
            regionStartBeat: clip.startBeat,
            regionEndBeat: clip.endBeat,
            sourceStartBeat: clip.startBeat,
        }));
    }

    const lane = laneState.lanes.find((takeLane) => takeLane.trackId === trackId);
    if (!lane || lane.activeCompRegions.length === 0) {
        return clips.map((clip) => ({
            ...clip,
            regionStartBeat: clip.startBeat,
            regionEndBeat: clip.endBeat,
            sourceStartBeat: clip.startBeat,
        }));
    }

    const resolvedClips: ResolvedClip[] = [];

    for (const region of lane.activeCompRegions) {
        const take = lane.takes.find((candidateTake) => candidateTake.id === region.takeId);
        if (!take) {
            continue;
        }

        const sourceClip = clips.find((clip) => clip.id === take.clipId);
        if (!sourceClip) {
            continue;
        }

        const overlapStart = Math.max(region.startBeat, sourceClip.startBeat);
        const overlapEnd = Math.min(region.endBeat, sourceClip.endBeat);
        if (overlapStart >= overlapEnd) {
            continue;
        }

        resolvedClips.push({
            ...sourceClip,
            startBeat: overlapStart,
            endBeat: overlapEnd,
            regionStartBeat: overlapStart,
            regionEndBeat: overlapEnd,
            sourceStartBeat: sourceClip.startBeat,
        });
    }

    const sortedRegions = lane.activeCompRegions;

    for (const clip of clips) {
        const gaps: { start: number; end: number }[] = [];
        let cursor = clip.startBeat;

        for (const region of sortedRegions) {
            if (region.endBeat <= clip.startBeat || region.startBeat >= clip.endBeat) {
                continue;
            }
            const regionStart = Math.max(region.startBeat, clip.startBeat);
            if (cursor < regionStart) {
                gaps.push({ start: cursor, end: regionStart });
            }
            cursor = Math.max(cursor, Math.min(region.endBeat, clip.endBeat));
        }
        if (cursor < clip.endBeat) {
            gaps.push({ start: cursor, end: clip.endBeat });
        }

        for (const gap of gaps) {
            resolvedClips.push({
                ...clip,
                startBeat: gap.start,
                endBeat: gap.end,
                regionStartBeat: gap.start,
                regionEndBeat: gap.end,
                sourceStartBeat: clip.startBeat,
            });
        }
    }

    return resolvedClips.sort((leftClip, rightClip) => leftClip.startBeat - rightClip.startBeat);
}

/**
 * Schedule a single track's clips into the given OfflineAudioContext.
 * Shared between mixdown and stem paths to avoid duplication.
 *
 * Worklet instrument note events are pushed to `pendingWorkletEvents`
 * rather than scheduling suspend() directly — the caller must invoke
 * `schedulePendingSuspends()` once after all tracks are processed.
 */
type OfflineProjectionDependencies = {
    projectMidiEvents: OfflineMidiEventProjector;
    projectPpqEndpoints: OfflinePpqEndpointProjector;
    processYeastMidi: OfflineYeastMidiProcessor | null;
    selectMidiEventProbability: OfflineMidiProbabilitySelector;
    projectChordPitch: OfflineChordPitchProjector;
    evaluateAutomationValue: OfflineAutomationValueEvaluator | null;
    resolveArticulationId?: OfflineMidiArticulationResolver | null;
};

export type ScheduleTrackClipsInput = {
    offlineCtx: OfflineAudioContext;
    track: Track;
    midi: NonNullable<MidiStoreState>;
    trackInputNode: GainNode;
    trackGainNode: GainNode;
    trackPanNode: StereoPannerNode;
    sendAutomationParams?: ReadonlyMap<string, AudioParam>;
    destination: AudioNode;
    durationSeconds: number;
    defaultTempo: number;
    changes: TempoMapStoreState['changes'];
    projections: OfflineProjectionDependencies;
    onWarning?: (message: string) => void;
    pendingWorkletEvents?: PendingWorkletEvent[];
    allTracks?: ReadonlyArray<Track>;
    /** Read-only: the backend that built these chains owns them and their teardown. */
    deviceEntriesByTrack?: ReadonlyMap<string, DeviceNodeEntry[]>;
    /** Full mix honors child-track mute; isolated stem/bounce renders include it. */
    honorMuted?: boolean;
    regionStartBeat?: number;
    /**
     * False bakes the take without the track's automation moves — a bounce
     * option, not an export one, so the mixdown and stem callers leave it unset.
     */
    includeAutomation?: boolean;
    /**
     * The track's VCA group master as a plain multiplier (`1` outside a group),
     * resolved by the calling render use case. A gain lane composes it into its
     * scheduled values the same way live does, so an automated VCA-member track
     * bounces at the level it plays.
     */
    vcaMultiplier?: number;
    /**
     * False drops this track's own `gain` and `pan` lanes from the render.
     *
     * Freeze passes false for its target: the fader and panner those lanes drive
     * stay live and are re-driven by `applyAutomation` when the frozen buffer is
     * replayed through them, so scheduling them here would apply every move
     * twice. Device lanes are unaffected — the device chain *is* bypassed at
     * replay, so its automation only survives if it is in the samples.
     */
    includeMixerAutomation?: boolean;
    /**
     * Accumulator the scheduler records what it actually put into the graph on.
     * Shared across every track of one render; omitted by callers that do not
     * need the observation. See `OfflineScheduleTally`.
     */
    tally?: OfflineScheduleTally;
    /** Render-time boundary after which scheduled sources belong to the returned buffer. */
    tallyStartSeconds?: number;
    /** Caller-owned cancellation for freeze/bounce scheduling. */
    abortSignal?: AbortSignal;
};

export async function scheduleTrackClips({
    offlineCtx,
    track,
    midi,
    trackInputNode,
    trackGainNode,
    trackPanNode,
    sendAutomationParams,
    destination,
    durationSeconds,
    defaultTempo,
    changes,
    projections,
    onWarning,
    pendingWorkletEvents,
    allTracks,
    deviceEntriesByTrack,
    honorMuted = true,
    regionStartBeat = 0,
    includeAutomation = true,
    vcaMultiplier = 1,
    includeMixerAutomation = true,
    tally,
    tallyStartSeconds = 0,
    abortSignal,
}: ScheduleTrackClipsInput): Promise<void> {
    function checkScheduleCancel(): void {
        checkCancel();
        checkCallerAbort();
    }

    function checkCallerAbort(): void {
        if (abortSignal?.aborted) {
            throw new Error('Render aborted');
        }
    }

    checkCallerAbort();
    const {
        evaluateAutomationValue,
        projectChordPitch,
        projectMidiEvents,
        projectPpqEndpoints,
        processYeastMidi,
        resolveArticulationId,
        selectMidiEventProbability,
    } = projections;
    function projectBeatToSeconds(beat: number): number {
        return projectPpqEndpoints({
            startPpq: beat,
            endPpq: beat,
            defaultTempo,
            sampleRate: offlineCtx.sampleRate,
            changes,
        }).startSeconds;
    }
    const regionStartSec = projectBeatToSeconds(regionStartBeat);
    const compensationDelay = getCompensationDelay(track.id);

    const allAutomationLanes = automationStore.value?.lanes ?? [];
    const automationLanes = includeMixerAutomation
        ? allAutomationLanes
        : allAutomationLanes.filter((lane) => {
              const drivesThisTracksMixer =
                  lane.trackId === track.id &&
                  MIXER_AUTOMATION_PARAMETER_IDS.some((parameterId) => parameterId === lane.parameterId);
              return !drivesThisTracksMixer;
          });
    let deviceEntries: DeviceNodeEntry[] = [];

    if (track.freezeState.status === 'frozen' && track.freezeState.frozenBufferId) {
        const frozenBuf = audioBufferCache.get(track.freezeState.frozenBufferId);
        if (frozenBuf) {
            // Frozen buffers render from the track's earliest clip startBeat
            // (scheduleFrozenTrack), not from timeline 0 — anchor the source
            // the same way: region exports start (regionStart - trackStart)
            // into the buffer; regions starting before the track content
            // start the buffer later at offset 0.
            const trackStartBeat = track.clips.length > 0 ? Math.min(...track.clips.map((clip) => clip.startBeat)) : 0;
            const trackStartSec = projectPpqEndpoints({
                startPpq: trackStartBeat,
                endPpq: trackStartBeat,
                defaultTempo,
                sampleRate: offlineCtx.sampleRate,
                changes,
            }).startSeconds;
            const when = Math.max(0, trackStartSec - regionStartSec);
            const bufferOffset = Math.max(0, regionStartSec - trackStartSec);
            const remaining = frozenBuf.duration - bufferOffset;
            if (remaining > 0) {
                const source = offlineCtx.createBufferSource();
                source.buffer = frozenBuf;
                source.connect(trackGainNode); // Skip trackInputNode to bypass device chain processing, but keep fader/pan
                source.start(when, bufferOffset, remaining);
                if (when + remaining > tallyStartSeconds) {
                    tally?.scheduledBuffers.push(frozenBuf);
                }
            }
        } else {
            onWarning?.(
                `Track "${track.name}" is frozen but its frozen buffer is missing and will be silent in the export. ` +
                    `Try unfreezing and re-freezing the track.`
            );
        }
    } else {
        // Use pre-built device chain if provided (Pass 2 of mixdown), otherwise build it (Stems export).
        if (deviceEntriesByTrack && deviceEntriesByTrack.has(track.id)) {
            deviceEntries = deviceEntriesByTrack.get(track.id)!;
        } else {
            deviceEntries = await buildDeviceChain(offlineCtx, track.devices, trackInputNode, trackPanNode, {
                trackName: track.name,
                onWarning,
            });
            trackPanNode.connect(destination);
        }
    }

    // Apply the same region/latency corrections clip scheduling gets, so
    // automation lands on the audio it shapes (M-038).
    // AU-12: clip-scoped automation lanes gate on their clip's beat span offline
    // exactly as the live path does (applyAutomation clip-bounds gate). Raw clip
    // bounds (pre-comping) match the live `track.clips.find(id)` lookup.
    const clipBoundsById = new Map<string, { startBeat: number; endBeat: number }>();
    for (const clip of track.clips) {
        clipBoundsById.set(clip.id, { startBeat: clip.startBeat, endBeat: clip.endBeat });
    }
    // `automationMode: 'off'` stops every lane on the track driving live
    // (`applyAutomation` gates on it before gain, pan and device params alike).
    // Offline read no mode at all, so a track the monitor plays flat bounced
    // fully automated. The bounce follows the monitor.
    const trackReadsAutomation = track.automationMode !== 'off';
    if (includeAutomation && trackReadsAutomation) {
        scheduleTrackAutomation({
            lanes: automationLanes,
            trackId: track.id,
            trackGainNode,
            trackPanNode,
            sendAutomationParams,
            deviceEntries,
            durationSeconds,
            defaultTempo,
            changes,
            // The live slew runs one step per scheduler tick, and the scheduler
            // ticks every `scheduleGrainMs`. Reading the same state is what keeps
            // the bounce's slew filter identical to the monitor's at every grain,
            // not only at the shipping default.
            slewTickSeconds: automationSlewTickSecondsForGrain(
                transportStore.value?.scheduleGrainMs ?? defaultTransportState.scheduleGrainMs
            ),
            // Arrangement's own law, injected at the composition root — the audio
            // engine may not import it (see `offlineDeviceParameterLawState`).
            deviceParameterLaw: {
                acceptsAutomation: ({ deviceId, deviceType, parameterId }) => {
                    const isAutomatable = offlineDeviceParameterLawState.isAutomatable;
                    if (!isAutomatable) {
                        return false;
                    }
                    const device = track.devices.find((candidate) => candidate.id === deviceId);
                    if (!device || device.parameterValues[parameterId] === undefined) {
                        return false;
                    }
                    return isAutomatable({ deviceType, paramId: parameterId });
                },
                clampValue: ({ deviceType, paramId, value }) =>
                    offlineDeviceParameterLawState.clampValue?.({ deviceType, paramId, value }) ?? value,
                // The declared *type*, applied to the emitted value only. Without
                // it the bounce rendered the slew's continuous filter state for a
                // parameter the monitor delivers as an integer — a lane on
                // `bacteria/bitDepth` played 16, 14, 13, 12 and bounced 14.4,
                // 13.44, 12.864.
                quantiseValue: ({ deviceType, paramId, value }) =>
                    offlineDeviceParameterLawState.quantiseValue?.({ deviceType, paramId, value }) ?? value,
            },
            regionStartSeconds: regionStartSec,
            projectBeatToSeconds,
            sampleRate: offlineCtx.sampleRate,
            compensationDelaySec: compensationDelay,
            clipBoundsById,
            vcaMultiplier,
        });
    }

    if (track.freezeState.status === 'frozen' && track.freezeState.frozenBufferId) {
        return;
    }

    const clipsToProcess: { clip: ResolvedClip; padIndex: number; sourceTrack: Track }[] = [];
    for (const clip of resolveTrackClipsWithComping(track.id, track.clips)) {
        clipsToProcess.push({ clip, padIndex: -1, sourceTrack: track });
    }

    const instrumentEntry = deviceEntries.find((event) => event.instrumentControls);
    const instrumentControls = instrumentEntry?.instrumentControls ?? null;
    const isToaster = instrumentEntry?.deviceType === 'toaster';
    const toasterDeviceId = isToaster ? instrumentEntry.deviceId : null;

    // If this is a Toaster track, gather all clips from its child tracks.
    if (isToaster && allTracks) {
        const children = allTracks.filter((time) => time.parentId === track.id);
        for (let index = 0; index < children.length; index++) {
            const childTrack = children[index];
            if (!childTrack || (honorMuted && childTrack.muted) || childTrack.disabled) {
                continue;
            }
            const childClips = resolveTrackClipsWithComping(childTrack.id, childTrack.clips);
            clipsToProcess.push(...childClips.map((clip) => ({ clip, padIndex: index, sourceTrack: childTrack })));
        }
    }

    type ScheduledMidiNote = {
        id: string;
        pitch: number;
        velocity: number;
        startSamples: number;
        endSamples: number;
        toasterPadIndex: number;
        articulationId?: number;
        channel?: number;
        pressure?: number;
        slide?: number;
        pitchBend?: number;
        pitchBendRangeSemitones?: number;
        clipGain: number;
    };
    type WorkletMidiEvent = {
        time: number;
        type: 'on' | 'off';
        pitch: number;
        velocity: number;
        duration: number;
        toasterPadIndex: number;
        articulationId?: number;
        channel?: number;
    };

    function clampOptional(value: number | undefined, minimum: number, maximum: number): number | undefined {
        if (value === undefined) {
            return undefined;
        }
        return Math.max(minimum, Math.min(maximum, value));
    }

    function resolveScheduledMpe(note: ScheduledMidiNote) {
        const hasExpression = note.pressure !== undefined || note.slide !== undefined || note.pitchBend !== undefined;
        if (!hasExpression) {
            return undefined;
        }

        const mpe = {
            pressure: clampOptional(note.pressure, 0, 127),
            slide: clampOptional(note.slide, 0, 127),
            pitchBend: clampOptional(note.pitchBend, -8192, 8191),
            pitchBendRangeSemitones: clampOptional(note.pitchBendRangeSemitones, 0, 127),
        };
        if (note.pitchBend !== undefined && mpe.pitchBendRangeSemitones === undefined) {
            mpe.pitchBendRangeSemitones = getDefaultBendRangeSemitones();
        }
        return mpe;
    }

    const drumKit = resolveDrumKit(track.devices);
    const drumKitDevice = track.devices.find(
        (device) => device.type === 'builtin-drum-kit' || device.type === 'drum-kit'
    );
    const kitDef = drumKitDevice
        ? getDrumKitDefByIndex(drumKitDevice.parameterValues.kit ?? drumKitDevice.parameterValues.kitId ?? 0)
        : null;
    const synthParams = drumKit || kitDef || instrumentControls ? null : getSynthParamsFromDevices(track.devices);
    function projectPitch({
        pitch,
        referenceBeat,
        targetBeat,
    }: {
        pitch: number;
        referenceBeat: number;
        targetBeat: number;
    }): number {
        if (!track.followChordTrack || drumKit || kitDef || isToaster) {
            return pitch;
        }
        return projectChordPitch({ pitch, referenceBeat, targetBeat });
    }
    const parentTrack =
        track.parentId && allTracks ? allTracks.find((candidate) => candidate.id === track.parentId) : null;
    const isToasterChild = !instrumentControls && parentTrack?.devices.some((device) => device.type === 'toaster');
    const workletEvents: WorkletMidiEvent[] = [];
    let noteCount = 0;

    function getScheduledArticulationId(articulation: string | undefined): number | undefined {
        if (!instrumentEntry) {
            return undefined;
        }
        return resolveArticulationId?.({ deviceType: instrumentEntry.deviceType, articulation }) ?? undefined;
    }

    function projectNoteEndpoints(startBeat: number, endBeat: number, toasterPadIndex: number) {
        const swingOffsetBeats =
            toasterPadIndex >= 0 && evaluateAutomationValue && toasterDeviceId
                ? getToasterSwingOffsetBeats({
                      parentTrackId: track.id,
                      toasterDeviceId,
                      automationMode: track.automationMode,
                      devices: track.devices,
                      lanes: automationLanes,
                      noteStartBeat: startBeat,
                      evaluateAutomationValue,
                  })
                : 0;
        return projectPpqEndpoints({
            startPpq: startBeat + swingOffsetBeats,
            endPpq: endBeat + swingOffsetBeats,
            defaultTempo,
            sampleRate: offlineCtx.sampleRate,
            changes,
        });
    }

    async function scheduleMidiNoteBatch(notes: readonly ScheduledMidiNote[]): Promise<void> {
        for (const note of notes) {
            checkScheduleCancel();
            if (note.endSamples <= regionStartSec * offlineCtx.sampleRate) {
                continue;
            }

            const rawStartSec = note.startSamples / offlineCtx.sampleRate + compensationDelay;
            const rawEndSec = note.endSamples / offlineCtx.sampleRate + compensationDelay;
            const startTime = Math.max(0, rawStartSec - regionStartSec);
            const endTime = Math.min(durationSeconds, rawEndSec - regionStartSec);
            const duration = endTime - startTime;
            if (startTime >= durationSeconds || duration <= 0) {
                continue;
            }

            if (instrumentControls) {
                // Toaster selects a sound by pad: fixed children use their
                // canonical sibling index, while direct parent clips use the
                // supported GM banks. MIDI 60 remains the neutral tuning
                // reference in both live and offline scheduling.
                let toasterPadIndex = note.toasterPadIndex;
                if (isToaster && toasterPadIndex < 0) {
                    const resolvedPad = resolveToasterPadIndex(note.pitch);
                    if (resolvedPad === null) {
                        continue;
                    }
                    toasterPadIndex = resolvedPad;
                }
                const instrumentPitch = isToaster ? TOASTER_NEUTRAL_MIDI_NOTE : note.pitch;
                // Live playback resolves an absent channel to the base channel
                // rather than leaving it unset, and the release is addressed to
                // the same one. Matching that here is what keeps a bounce from
                // releasing every voice at a pitch when the session releases one.
                const noteChannel = note.channel ?? 0;
                workletEvents.push({
                    time: startTime,
                    type: 'on',
                    pitch: instrumentPitch,
                    velocity: note.velocity,
                    duration,
                    toasterPadIndex,
                    articulationId: note.articulationId,
                    channel: noteChannel,
                });
                if (!isToaster) {
                    workletEvents.push({
                        time: endTime,
                        type: 'off',
                        pitch: instrumentPitch,
                        velocity: 0,
                        duration: 0,
                        toasterPadIndex,
                        channel: noteChannel,
                    });
                }
            } else if (kitDef) {
                scheduleDrumKitNote(
                    offlineCtx,
                    trackInputNode,
                    kitDef,
                    note.pitch,
                    startTime,
                    note.velocity,
                    note.clipGain
                );
            } else if (drumKit) {
                scheduleKitNote(
                    offlineCtx,
                    trackInputNode,
                    drumKit,
                    note.pitch,
                    startTime,
                    duration,
                    note.velocity,
                    note.clipGain
                );
            } else {
                const mpe = resolveScheduledMpe(note);
                scheduleNoteOffline(
                    offlineCtx,
                    trackInputNode,
                    note.pitch,
                    startTime,
                    duration,
                    note.velocity,
                    synthParams!,
                    mpe,
                    note.clipGain
                );
            }

            noteCount++;
            // Counted here, past every `continue` above, so this is the number
            // of notes an instrument was actually asked to play — not the
            // number the store holds.
            if (tally && rawEndSec > tallyStartSeconds) {
                tally.scheduledNotes++;
            }
            if (noteCount % YIELD_EVERY_N_NOTES === 0) {
                await yieldToMain();
            }
        }
    }

    const yeastSourceTracks = new Map<string, Track>();
    if (processYeastMidi && !isToasterChild) {
        for (const { sourceTrack } of clipsToProcess) {
            if (sourceTrack.kind === 'midi' && sourceTrack.devices.some((device) => device.type === 'yeast')) {
                yeastSourceTracks.set(sourceTrack.id, sourceTrack);
            }
        }
    }
    for (const yeastSourceTrack of yeastSourceTracks.values()) {
        checkCallerAbort();
        if (!processYeastMidi) {
            break;
        }
        const iterations: Parameters<typeof projectOfflineYeastTrackNotes>[0]['iterations'][number][] = [];
        for (const { clip, padIndex, sourceTrack } of clipsToProcess) {
            if (sourceTrack.id !== yeastSourceTrack.id) {
                continue;
            }
            if (clip.type !== 'midi' || clip.muted || clip.endBeat <= regionStartBeat) {
                continue;
            }
            const sourceNotes = midi.notesByClipId[clip.id];
            const clipVisualLength = clip.endBeat - clip.startBeat;
            if (!sourceNotes || clipVisualLength <= 0) {
                continue;
            }
            const loopProjection = projectClipLoopExpansion({
                clipDurationBeats: clipVisualLength,
                configuredLoopLengthBeats: clip.loopLength,
                loopEnabled: clip.loopEnabled ?? false,
            });
            const loopLength = loopProjection.loopLengthBeats;
            const sourceOccurrenceOffset = getSourceOccurrenceOffset({
                sourceStartBeat: clip.sourceStartBeat,
                segmentStartBeat: clip.startBeat,
                loopLength,
                loopEnabled: clip.loopEnabled ?? false,
            });
            const iterationCount = loopProjection.iterationCount;
            for (let iteration = 0; iteration < iterationCount; iteration++) {
                checkCallerAbort();
                const absoluteOccurrenceIndex = sourceOccurrenceOffset + iteration;
                iterations.push({
                    sourceNotes: sourceNotes.filter((note) =>
                        selectMidiEventProbability({
                            projectProbabilitySeed: midi.probabilitySeed,
                            clipId: clip.id,
                            eventId: note.id,
                            absoluteOccurrenceIndex,
                            probabilityPercent: note.probability ?? 100,
                        })
                    ),
                    clipId: clip.id,
                    clipStartBeat: clip.startBeat,
                    clipEndBeat: clip.endBeat,
                    iterationStartBeat: clip.startBeat + iteration * loopLength,
                    loopLengthBeats: loopLength,
                    midiOffsetBeats: clip.midiOffsetBeats ?? 0,
                    loopEnabled: clip.loopEnabled ?? false,
                    toasterPadIndex: padIndex,
                    clipGain: clip.gain,
                });
            }
        }
        if (iterations.length > 0) {
            const scheduledNotes = projectOfflineYeastTrackNotes({
                trackId: yeastSourceTrack.id,
                iterations,
                sampleRate: offlineCtx.sampleRate,
                blockStartSamples: Math.floor(regionStartSec * offlineCtx.sampleRate),
                blockEndSamples: Math.ceil((regionStartSec + durationSeconds) * offlineCtx.sampleRate),
                defaultTempo,
                changes,
                projectMidiEvents,
                projectPpqEndpoints,
                processYeastMidi,
                projectPitch,
            });
            await scheduleMidiNoteBatch(
                scheduledNotes.map((note) => {
                    if (note.toasterPadIndex < 0) {
                        return note;
                    }
                    const endpoints = projectNoteEndpoints(note.startBeat, note.endBeat, note.toasterPadIndex);
                    return {
                        ...note,
                        startSamples: endpoints.startSamples,
                        endSamples: endpoints.endSamples,
                    };
                })
            );
        }
    }

    for (const { clip, padIndex: toasterPadIndex, sourceTrack } of clipsToProcess) {
        checkCallerAbort();
        // Skip muted clips — they should not render audio.
        if (clip.muted) {
            continue;
        }

        // Region-bounded export: drop clips that end before the region start.
        if (clip.endBeat <= regionStartBeat) {
            continue;
        }

        const clipVisualLength = clip.endBeat - clip.startBeat;
        if (clipVisualLength <= 0) {
            onWarning?.(
                `Clip "${clip.name || clip.id}" on track "${track.name}" has zero or negative duration and was skipped.`
            );
            continue;
        }

        const loopProjection = projectClipLoopExpansion({
            clipDurationBeats: clipVisualLength,
            configuredLoopLengthBeats: clip.loopLength,
            loopEnabled: clip.loopEnabled ?? false,
        });
        const loopLen = loopProjection.loopLengthBeats;
        const maxIterations = loopProjection.iterationCount;
        const sourceOccurrenceOffset = getSourceOccurrenceOffset({
            sourceStartBeat: clip.sourceStartBeat,
            segmentStartBeat: clip.startBeat,
            loopLength: loopLen,
            loopEnabled: clip.loopEnabled ?? false,
        });

        if (clip.type === 'midi') {
            const sourceNotes = midi.notesByClipId[clip.id];
            if (!sourceNotes) {
                continue;
            }
            const hasYeast = sourceTrack.devices.some((device) => device.type === 'yeast');
            if (isToasterChild || (hasYeast && processYeastMidi)) {
                continue;
            }

            for (let iter = 0; iter < maxIterations; iter++) {
                checkCallerAbort();
                const absoluteOccurrenceIndex = sourceOccurrenceOffset + iter;
                const iterOffset = iter * loopLen;
                const iterationStartBeat = clip.startBeat + iterOffset;
                const midiOffsetBeats = clip.midiOffsetBeats ?? 0;
                const acceptedSourceNotes = sourceNotes.filter((note) =>
                    selectMidiEventProbability({
                        projectProbabilitySeed: midi.probabilitySeed,
                        clipId: clip.id,
                        eventId: note.id,
                        absoluteOccurrenceIndex,
                        probabilityPercent: note.probability ?? 100,
                    })
                );
                const notes = projectMidiEvents({
                    events: acceptedSourceNotes,
                    clipId: clip.id,
                    clipStartBeat: clip.startBeat,
                    clipEndBeat: clip.endBeat,
                    iterationStartBeat,
                    loopLengthBeats: loopLen,
                    midiOffsetBeats,
                    loopEnabled: clip.loopEnabled ?? false,
                    phase: 'complete',
                });
                const scheduledNotes = notes.map((note) => {
                    const endpoints = projectNoteEndpoints(
                        note.startBeat,
                        note.startBeat + note.duration,
                        toasterPadIndex
                    );
                    return {
                        id: note.id,
                        pitch: projectPitch({
                            pitch: note.pitch,
                            referenceBeat: clip.startBeat,
                            targetBeat: note.startBeat,
                        }),
                        velocity: note.velocity,
                        startSamples: endpoints.startSamples,
                        endSamples: endpoints.endSamples,
                        toasterPadIndex,
                        articulationId: getScheduledArticulationId(note.articulation),
                        channel: note.channel,
                        pressure: note.pressure,
                        slide: note.slide,
                        pitchBend: note.pitchBend,
                        pitchBendRangeSemitones: note.pitchBendRangeSemitones,
                        clipGain: clip.gain,
                    };
                });
                await scheduleMidiNoteBatch(scheduledNotes);
            }
        } else if (clip.type === 'audio' && clip.audioBufferId) {
            const buffer = audioBufferCache.get(clip.audioBufferId);
            if (!buffer) {
                onWarning?.(
                    `Audio clip "${clip.name}" is missing its audio buffer and will be silent in the export. ` +
                        `Try re-importing the file or reloading the project.`
                );
                continue;
            }

            const stretchRatio = clip.stretchMode && clip.stretchMode !== 'off' ? (clip.stretchRatio ?? 1) : 1;
            // Clamp stretchRatio to a sane positive range — zero or negative would
            // cause division-by-zero in `buffer.duration / stretchRatio`.
            const safeStretchRatio = Math.max(0.01, Math.min(100, stretchRatio));
            const clipGainValue = clip.gain;

            for (let iter = 0; iter < maxIterations; iter++) {
                checkCallerAbort();
                const iterStartBeat = clip.startBeat + iter * loopLen;
                if (iterStartBeat >= clip.endBeat) {
                    break;
                }

                const remainingBeats = Math.min(loopLen, clip.endBeat - iterStartBeat);
                const iterEndBeat = iterStartBeat + remainingBeats;
                if (iterEndBeat <= regionStartBeat) {
                    continue;
                }

                const rawIterStartSec = projectBeatToSeconds(iterStartBeat) + compensationDelay;
                const rawIterEndSec = projectBeatToSeconds(iterEndBeat) + compensationDelay;
                const iterStartTime = rawIterStartSec - regionStartSec;
                const iterEndTime = rawIterEndSec - regionStartSec;
                if (iterStartTime >= durationSeconds) {
                    break;
                }

                const isFirstIter = iter === 0;
                const isLastIter = iter === maxIterations - 1 || iterStartBeat + loopLen >= clip.endBeat;

                const iterDurationSec = iterEndTime - iterStartTime;
                // Destination seconds, like every other quantity in this block:
                // the whole buffer read at this rate sounds for
                // `buffer.duration / rate` of the timeline. `scheduleOfflineClipSource`
                // scales the span back into source seconds for `start()`, so a
                // ceiling stated here bounds the material that is read.
                const maxBufferSec = buffer.duration / safeStretchRatio;
                const availableSec = Math.min(iterDurationSec, maxBufferSec);

                // If this iteration straddles the region start, trim the leading portion
                // by advancing the buffer read offset and clamping start to 0.
                const trimBeforeSec = Math.max(0, -iterStartTime);
                const bufferOffsetSec = trimBeforeSec * safeStretchRatio;
                if (bufferOffsetSec >= buffer.duration) {
                    continue;
                }

                const startSec = Math.max(0, iterStartTime);
                const playDuration = Math.max(0, availableSec - trimBeforeSec);

                if (playDuration <= 0) {
                    continue;
                }

                // `isFirstIter && trimBeforeSec === 0` is what makes a fade in
                // present at all: a later loop iteration, or one entered
                // part-way by the region trim, continues an unbroken sound and
                // must not dip at the seam. `isLastIter` is the same question
                // for the tail.
                // Within a fade that is present, a zero-length user fade leaves
                // `userEndSec`/`userStartSec` absent, which the scheduler reads
                // as the anti-click micro-fade.
                const fadeIn =
                    isFirstIter && trimBeforeSec === 0
                        ? {
                              userEndSec:
                                  clip.fadeInBeats > 0
                                      ? projectBeatToSeconds(clip.startBeat + clip.fadeInBeats) +
                                        compensationDelay -
                                        regionStartSec
                                      : undefined,
                          }
                        : undefined;
                const fadeOut = isLastIter
                    ? {
                          userStartSec:
                              clip.fadeOutBeats > 0
                                  ? projectBeatToSeconds(clip.endBeat - clip.fadeOutBeats) +
                                    compensationDelay -
                                    regionStartSec
                                  : undefined,
                      }
                    : undefined;

                scheduleOfflineClipSource({
                    context: offlineCtx,
                    destinationNode: trackInputNode,
                    buffer,
                    startSec,
                    bufferOffsetSec,
                    playDuration,
                    playbackRate: safeStretchRatio,
                    clipGainValue,
                    fadeIn,
                    fadeOut,
                    microFadeSeconds: MICRO_FADE_SECONDS,
                });
                if (rawIterEndSec > tallyStartSeconds) {
                    tally?.scheduledBuffers.push(buffer);
                }
            }
        }
    }

    if (instrumentControls && workletEvents.length > 0 && pendingWorkletEvents) {
        for (const event of workletEvents) {
            const pendingEvent: PendingWorkletEvent = {
                time: event.time,
                type: event.type,
                pitch: event.pitch,
                velocity: event.velocity,
                instrumentControls,
                isToaster,
                toasterPadIndex: event.toasterPadIndex,
            };
            if (event.articulationId !== undefined) {
                pendingEvent.articulationId = event.articulationId;
            }
            if (event.channel !== undefined) {
                pendingEvent.channel = event.channel;
            }
            pendingWorkletEvents.push(pendingEvent);
        }
    }
}
