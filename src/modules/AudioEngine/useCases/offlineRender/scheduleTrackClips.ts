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
import { type TempoMapStoreState } from '#/modules/Transport/stores';
import { resolveToasterPadIndex, TOASTER_NEUTRAL_MIDI_NOTE } from '#/utils/toasterNoteProjection';
import { getToasterSwingOffsetBeats } from '#/utils/toasterSwingProjection';

import { scheduleTrackAutomation } from '../../repositories/offlineScheduler/automationScheduling';
import {
    type OfflineMidiEventProjector,
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

import { MICRO_FADE_SECONDS, YIELD_EVERY_N_NOTES } from './constants';
import { projectOfflineYeastTrackNotes } from './projectOfflineYeastTrackNotes';
import { type PendingWorkletEvent } from './types';
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
};

export type ScheduleTrackClipsInput = {
    offlineCtx: OfflineAudioContext;
    track: Track;
    midi: NonNullable<MidiStoreState>;
    trackInputNode: GainNode;
    trackGainNode: GainNode;
    trackPanNode: StereoPannerNode;
    destination: AudioNode;
    durationSeconds: number;
    defaultTempo: number;
    changes: TempoMapStoreState['changes'];
    projections: OfflineProjectionDependencies;
    onWarning?: (message: string) => void;
    pendingWorkletEvents?: PendingWorkletEvent[];
    allTracks?: ReadonlyArray<Track>;
    deviceEntriesByTrack?: Map<string, DeviceNodeEntry[]>;
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
};

export async function scheduleTrackClips({
    offlineCtx,
    track,
    midi,
    trackInputNode,
    trackGainNode,
    trackPanNode,
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
}: ScheduleTrackClipsInput): Promise<void> {
    const {
        evaluateAutomationValue,
        projectChordPitch,
        projectMidiEvents,
        projectPpqEndpoints,
        processYeastMidi,
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

    const automationLanes = automationStore.value?.lanes ?? [];
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
            deviceEntries = await buildDeviceChain(offlineCtx, track.devices, trackInputNode, trackPanNode);
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
    if (includeAutomation) {
        scheduleTrackAutomation(
            automationLanes,
            track.id,
            trackGainNode,
            trackPanNode,
            deviceEntries,
            durationSeconds,
            defaultTempo,
            changes,
            regionStartSec,
            projectBeatToSeconds,
            offlineCtx.sampleRate,
            compensationDelay,
            clipBoundsById,
            vcaMultiplier
        );
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
    };
    type WorkletMidiEvent = {
        time: number;
        type: 'on' | 'off';
        pitch: number;
        velocity: number;
        duration: number;
        toasterPadIndex: number;
    };

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
                workletEvents.push({
                    time: startTime,
                    type: 'on',
                    pitch: instrumentPitch,
                    velocity: note.velocity,
                    duration,
                    toasterPadIndex,
                });
                if (!isToaster) {
                    workletEvents.push({
                        time: endTime,
                        type: 'off',
                        pitch: instrumentPitch,
                        velocity: 0,
                        duration: 0,
                        toasterPadIndex,
                    });
                }
            } else if (kitDef) {
                scheduleDrumKitNote(offlineCtx, trackInputNode, kitDef, note.pitch, startTime, note.velocity);
            } else if (drumKit) {
                scheduleKitNote(offlineCtx, trackInputNode, drumKit, note.pitch, startTime, duration, note.velocity);
            } else {
                scheduleNoteOffline(
                    offlineCtx,
                    trackInputNode,
                    note.pitch,
                    startTime,
                    duration,
                    note.velocity,
                    synthParams!
                );
            }

            noteCount++;
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
            const rawLoopLength = clip.loopEnabled ? (clip.loopLength ?? clipVisualLength) : clipVisualLength;
            const loopLength = rawLoopLength > 0 ? rawLoopLength : clipVisualLength;
            const sourceOccurrenceOffset = getSourceOccurrenceOffset({
                sourceStartBeat: clip.sourceStartBeat,
                segmentStartBeat: clip.startBeat,
                loopLength,
                loopEnabled: clip.loopEnabled ?? false,
            });
            const iterationCount = clip.loopEnabled ? Math.ceil(clipVisualLength / loopLength) : 1;
            for (let iteration = 0; iteration < iterationCount; iteration++) {
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
                    return { ...note, startSamples: endpoints.startSamples, endSamples: endpoints.endSamples };
                })
            );
        }
    }

    for (const { clip, padIndex: toasterPadIndex, sourceTrack } of clipsToProcess) {
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

        const rawLoopLen = clip.loopEnabled ? (clip.loopLength ?? clipVisualLength) : clipVisualLength;
        // Guard against corrupt loopLength (zero or negative would cause infinite loops / NaN).
        const loopLen = rawLoopLen > 0 ? rawLoopLen : clipVisualLength;
        const maxIterations = clip.loopEnabled ? Math.ceil(clipVisualLength / loopLen) : 1;
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

                const source = offlineCtx.createBufferSource();
                source.buffer = buffer;
                if (safeStretchRatio !== 1) {
                    source.playbackRate.value = safeStretchRatio;
                }

                const endSec = startSec + playDuration;

                const fadeGain = offlineCtx.createGain();
                source.connect(fadeGain);
                fadeGain.connect(trackInputNode);

                fadeGain.gain.setValueAtTime(clipGainValue, startSec);

                if (isFirstIter && trimBeforeSec === 0) {
                    if (clip.fadeInBeats > 0) {
                        const fadeInEndBeat = clip.startBeat + clip.fadeInBeats;
                        const fadeInEndSec = projectBeatToSeconds(fadeInEndBeat) + compensationDelay - regionStartSec;
                        const fadeInDuration = Math.min(
                            Math.max(MICRO_FADE_SECONDS, fadeInEndSec - iterStartTime),
                            playDuration * 0.5
                        );
                        fadeGain.gain.setValueAtTime(0, startSec);
                        fadeGain.gain.linearRampToValueAtTime(clipGainValue, startSec + fadeInDuration);
                    } else {
                        fadeGain.gain.setValueAtTime(0, startSec);
                        fadeGain.gain.linearRampToValueAtTime(clipGainValue, startSec + MICRO_FADE_SECONDS);
                    }
                }

                if (isLastIter) {
                    if (clip.fadeOutBeats > 0) {
                        const fadeOutStartBeat = clip.endBeat - clip.fadeOutBeats;
                        const fadeOutStartSec =
                            projectBeatToSeconds(fadeOutStartBeat) + compensationDelay - regionStartSec;
                        const fadeOutOffset = Math.max(
                            startSec,
                            Math.max(fadeOutStartSec, endSec - playDuration * 0.5)
                        );
                        fadeGain.gain.setValueAtTime(clipGainValue, fadeOutOffset);
                        fadeGain.gain.linearRampToValueAtTime(0, endSec);
                    } else {
                        fadeGain.gain.setValueAtTime(clipGainValue, Math.max(startSec, endSec - MICRO_FADE_SECONDS));
                        fadeGain.gain.linearRampToValueAtTime(0, endSec);
                    }
                }

                // duration arg is destination-timeline seconds — NOT buffer-time scaled by playbackRate.
                source.start(startSec, bufferOffsetSec, playDuration);
            }
        }
    }

    if (instrumentControls && workletEvents.length > 0 && pendingWorkletEvents) {
        for (const event of workletEvents) {
            pendingWorkletEvents.push({
                time: event.time,
                type: event.type,
                pitch: event.pitch,
                velocity: event.velocity,
                instrumentControls,
                isToaster,
                toasterPadIndex: event.toasterPadIndex,
            });
        }
    }
}
