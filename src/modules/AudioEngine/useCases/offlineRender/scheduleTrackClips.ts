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

import { scheduleTrackAutomation } from '../../repositories/offlineScheduler/automationScheduling';
import { type OfflineMidiEventProjector } from '../../repositories/offlineScheduler/offlineMidiEventProjectorState';
import { type OfflinePpqEndpointProjector } from '../../repositories/offlineScheduler/offlinePpqEndpointProjectorState';
import { type OfflineYeastMidiProcessor } from '../../repositories/offlineScheduler/offlineYeastMidiProcessorState';
import { beatToSeconds } from '../../services/beatConversion';
import { resolveDrumKit } from '../../services/deviceResolution';
import { audioBufferCache } from '../../stores/audioBufferCache';
import { type DeviceNodeEntry, buildDeviceChain } from '../buildDeviceChain';
import { getCompensationDelay } from '../latencyCompensation/compensation/getCompensationDelay';

import { MICRO_FADE_SECONDS, YIELD_EVERY_N_NOTES } from './constants';
import { projectOfflineYeastClipNotes } from './projectOfflineYeastClipNotes';
import { type PendingWorkletEvent } from './types';
import { yieldToMain } from './yieldToMain';

type ResolvedClip = Track['clips'][number] & {
    regionStartBeat: number;
    regionEndBeat: number;
};

function resolveTrackClipsWithComping(trackId: string, clips: Track['clips']): ResolvedClip[] {
    const laneState = takeLaneStore.value;
    if (!laneState) {
        return clips.map((clip) => ({ ...clip, regionStartBeat: clip.startBeat, regionEndBeat: clip.endBeat }));
    }

    const lane = laneState.lanes.find((takeLane) => takeLane.trackId === trackId);
    if (!lane || lane.activeCompRegions.length === 0) {
        return clips.map((clip) => ({ ...clip, regionStartBeat: clip.startBeat, regionEndBeat: clip.endBeat }));
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
    regionStartBeat?: number;
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
    regionStartBeat = 0,
}: ScheduleTrackClipsInput): Promise<void> {
    const { projectMidiEvents, projectPpqEndpoints, processYeastMidi } = projections;
    const regionStartSec = projectPpqEndpoints({
        startPpq: regionStartBeat,
        endPpq: regionStartBeat,
        defaultTempo,
        sampleRate: offlineCtx.sampleRate,
        changes,
    }).startSeconds;
    const compensationDelay = getCompensationDelay(track.id);

    const automationLanes = automationStore.value?.lanes ?? [];
    let deviceEntries: DeviceNodeEntry[] = [];

    if (track.freezeState.status === 'frozen' && track.freezeState.frozenBufferId) {
        const frozenBuf = audioBufferCache.get(track.freezeState.frozenBufferId);
        if (frozenBuf) {
            const source = offlineCtx.createBufferSource();
            source.buffer = frozenBuf;
            source.connect(trackGainNode); // Skip trackInputNode to bypass device chain processing, but keep fader/pan
            source.start(0);
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

    scheduleTrackAutomation(
        automationLanes,
        track.id,
        trackGainNode,
        trackPanNode,
        deviceEntries,
        durationSeconds,
        defaultTempo,
        changes
    );

    if (track.freezeState.status === 'frozen' && track.freezeState.frozenBufferId) {
        return;
    }

    const clipsToProcess: { clip: Track['clips'][number]; padIndex: number }[] = [];
    clipsToProcess.push(...resolveTrackClipsWithComping(track.id, track.clips).map((clip) => ({ clip, padIndex: -1 })));

    const instrumentEntry = deviceEntries.find((event) => event.instrumentControls);
    const instrumentControls = instrumentEntry?.instrumentControls ?? null;
    const isToaster = instrumentEntry?.deviceType === 'toaster';

    // If this is a Toaster track, gather all clips from its child tracks.
    if (isToaster && allTracks) {
        const children = allTracks.filter((time) => time.parentId === track.id);
        for (let index = 0; index < children.length; index++) {
            const childTrack = children[index];
            if (!childTrack) {
                continue;
            }
            const childClips = resolveTrackClipsWithComping(childTrack.id, childTrack.clips);
            clipsToProcess.push(...childClips.map((clip) => ({ clip, padIndex: index })));
        }
    }

    for (const { clip, padIndex: toasterPadIndex } of clipsToProcess) {
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

        if (clip.type === 'midi') {
            const sourceNotes = midi.notesByClipId[clip.id];
            if (!sourceNotes) {
                continue;
            }

            const drumKit = resolveDrumKit(track.devices);
            const drumKitDevice = track.devices.find(
                (data) => data.type === 'builtin-drum-kit' || data.type === 'drum-kit'
            );
            const kitDef = drumKitDevice
                ? getDrumKitDefByIndex(drumKitDevice.parameterValues.kit ?? drumKitDevice.parameterValues.kitId ?? 0)
                : null;

            // Only Toaster parent tracks play their own children's clips. If this
            // is a child track of a Toaster, skip note processing — the parent
            // will gather them.
            if (!instrumentControls && track.parentId && allTracks) {
                const parentTrack = allTracks.find((time) => time.id === track.parentId);
                if (parentTrack?.devices.some((data) => data.type === 'toaster')) {
                    continue;
                }
            }

            const synthParams =
                drumKit || kitDef || instrumentControls ? null : getSynthParamsFromDevices(track.devices);
            const hasYeast = track.devices.some((device) => device.type === 'yeast');

            let noteCount = 0;

            type NoteEvent = { time: number; type: 'on' | 'off'; pitch: number; velocity: number; duration: number };
            const workletEvents: NoteEvent[] = [];

            for (let iter = 0; iter < maxIterations; iter++) {
                const iterOffset = iter * loopLen;
                const iterationStartBeat = clip.startBeat + iterOffset;
                const midiOffsetBeats = clip.midiOffsetBeats ?? 0;
                let scheduledNotes: Array<{
                    id: string;
                    pitch: number;
                    velocity: number;
                    startSamples: number;
                    endSamples: number;
                }>;
                if (hasYeast && processYeastMidi) {
                    scheduledNotes = projectOfflineYeastClipNotes({
                        trackId: track.id,
                        sourceNotes,
                        clipId: clip.id,
                        clipStartBeat: clip.startBeat,
                        clipEndBeat: clip.endBeat,
                        iterationStartBeat,
                        loopLengthBeats: loopLen,
                        midiOffsetBeats,
                        loopEnabled: clip.loopEnabled ?? false,
                        sampleRate: offlineCtx.sampleRate,
                        blockStartSamples: Math.floor(regionStartSec * offlineCtx.sampleRate),
                        blockEndSamples: Math.ceil((regionStartSec + durationSeconds) * offlineCtx.sampleRate),
                        defaultTempo,
                        changes,
                        projectMidiEvents,
                        projectPpqEndpoints,
                        processYeastMidi,
                    });
                } else {
                    const notes = projectMidiEvents({
                        events: sourceNotes,
                        clipId: clip.id,
                        clipStartBeat: clip.startBeat,
                        clipEndBeat: clip.endBeat,
                        iterationStartBeat,
                        loopLengthBeats: loopLen,
                        midiOffsetBeats,
                        loopEnabled: clip.loopEnabled ?? false,
                        phase: 'complete',
                    });
                    scheduledNotes = notes.map((note) => {
                        const endpoints = projectPpqEndpoints({
                            startPpq: note.startBeat,
                            endPpq: note.startBeat + note.duration,
                            defaultTempo,
                            sampleRate: offlineCtx.sampleRate,
                            changes,
                        });
                        return {
                            id: note.id,
                            pitch: note.pitch,
                            velocity: note.velocity,
                            startSamples: endpoints.startSamples,
                            endSamples: endpoints.endSamples,
                        };
                    });
                }

                for (const note of scheduledNotes) {
                    if (note.endSamples <= regionStartSec * offlineCtx.sampleRate) {
                        continue;
                    }

                    // Apply plugin-delay compensation symmetrically with the audio
                    // branch (see the `+ compensationDelay` on the audio iteration
                    // below) so instrument notes stay aligned with audio clips.
                    const rawStartSec = note.startSamples / offlineCtx.sampleRate + compensationDelay;
                    const rawEndSec = note.endSamples / offlineCtx.sampleRate + compensationDelay;
                    const startTime = Math.max(0, rawStartSec - regionStartSec);
                    const endTime = Math.min(durationSeconds, rawEndSec - regionStartSec);
                    const duration = endTime - startTime;
                    if (startTime >= durationSeconds || duration <= 0) {
                        continue;
                    }

                    if (instrumentControls) {
                        workletEvents.push({
                            time: startTime,
                            type: 'on',
                            pitch: note.pitch,
                            velocity: note.velocity,
                            duration,
                        });
                        workletEvents.push({ time: endTime, type: 'off', pitch: note.pitch, velocity: 0, duration: 0 });
                    } else if (kitDef) {
                        scheduleDrumKitNote(offlineCtx, trackInputNode, kitDef, note.pitch, startTime, note.velocity);
                    } else if (drumKit) {
                        scheduleKitNote(
                            offlineCtx,
                            trackInputNode,
                            drumKit,
                            note.pitch,
                            startTime,
                            duration,
                            note.velocity
                        );
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

            if (instrumentControls && workletEvents.length > 0 && pendingWorkletEvents) {
                for (const evt of workletEvents) {
                    pendingWorkletEvents.push({
                        time: evt.time,
                        type: evt.type,
                        pitch: evt.pitch,
                        velocity: evt.velocity,
                        instrumentControls,
                        isToaster,
                        toasterPadIndex,
                    });
                }
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

                const rawIterStartSec = beatToSeconds(iterStartBeat, defaultTempo, changes) + compensationDelay;
                const rawIterEndSec = beatToSeconds(iterEndBeat, defaultTempo, changes) + compensationDelay;
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
                        const fadeInEndSec = beatToSeconds(fadeInEndBeat, defaultTempo, changes) - regionStartSec;
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
                            beatToSeconds(fadeOutStartBeat, defaultTempo, changes) + compensationDelay - regionStartSec;
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
}
