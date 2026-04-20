import { type Track } from '#/modules/Arrangement/models/Track';
import { resolveClipsWithComping } from '#/modules/Arrangement/useCases';
import { getAutomationLanes } from '#/modules/Automation/useCases';
import { type getMidiStoreState } from '#/modules/MIDI/useCases';
import {
    getDrumKitDefByIndex,
    getSynthParamsFromDevices,
    scheduleDrumKitNote,
    scheduleKitNote,
    scheduleNoteOffline,
} from '#/modules/Synth/useCases';
import { type TempoChange } from '#/modules/Transport/useCases';

import { scheduleTrackAutomation } from '../../repositories/offlineScheduler/automationScheduling';
import { beatToSeconds } from '../../services/beatConversion';
import { resolveDrumKit } from '../../services/deviceResolution';
import { audioBufferCache } from '../../stores/audioBufferCache';
import { type DeviceNodeEntry, buildDeviceChain } from '../buildDeviceChain';
import { getCompensationDelay } from '../latencyCompensation/compensation/getCompensationDelay';

import { MICRO_FADE_SECONDS, YIELD_EVERY_N_NOTES } from './constants';
import { type PendingWorkletEvent } from './types';
import { yieldToMain } from './yieldToMain';

/**
 * Schedule a single track's clips into the given OfflineAudioContext.
 * Shared between mixdown and stem paths to avoid duplication.
 *
 * Worklet instrument note events are pushed to `pendingWorkletEvents`
 * rather than scheduling suspend() directly — the caller must invoke
 * `schedulePendingSuspends()` once after all tracks are processed.
 */
export async function scheduleTrackClips(
    offlineCtx: OfflineAudioContext,
    track: Track,
    midi: NonNullable<ReturnType<typeof getMidiStoreState>>,
    trackInputNode: GainNode,
    trackGainNode: GainNode,
    trackPanNode: StereoPannerNode,
    destination: AudioNode,
    durationSeconds: number,
    defaultTempo: number,
    changes: TempoChange[],
    onWarning?: (message: string) => void,
    pendingWorkletEvents?: PendingWorkletEvent[],
    allTracks?: ReadonlyArray<Track>,
    deviceEntriesByTrack?: Map<string, DeviceNodeEntry[]>
): Promise<void> {
    const compensationDelay = getCompensationDelay(track.id);

    const automationLanes = getAutomationLanes();
    let deviceEntries: DeviceNodeEntry[] = [];

    if (track.freezeState?.status === 'frozen' && track.freezeState?.frozenBufferId) {
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

    if (track.freezeState?.status === 'frozen' && track.freezeState?.frozenBufferId) {
        // Skip scheduling individual clips and MIDI since we already scheduled the frozen buffer
        return;
    }

    const clipsToProcess: { clip: import('#/modules/Arrangement/models/Track').Clip; padIndex: number }[] = [];
    clipsToProcess.push(...resolveClipsWithComping(track.id, track.clips).map((c) => ({ clip: c, padIndex: -1 })));

    const instrumentEntry = deviceEntries.find((e) => e.instrumentControls);
    const instrumentControls = instrumentEntry?.instrumentControls ?? null;
    const isToaster = instrumentEntry?.deviceType === 'toaster';

    // If this is a Toaster track, gather all clips from its child tracks.
    if (isToaster && allTracks) {
        const children = allTracks.filter((t) => t.parentId === track.id);
        for (let i = 0; i < children.length; i++) {
            const childTrack = children[i];
            if (!childTrack) {
                continue;
            }
            const childClips = resolveClipsWithComping(childTrack.id, childTrack.clips);
            clipsToProcess.push(...childClips.map((c) => ({ clip: c, padIndex: i })));
        }
    }

    for (const { clip, padIndex: toasterPadIndex } of clipsToProcess) {
        // Skip muted clips — they should not render audio.
        if (clip.muted) {
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
            const notes = midi.notesByClipId[clip.id];
            if (!notes) {
                continue;
            }

            const drumKit = resolveDrumKit(track.devices);
            const drumKitDevice = track.devices.find((d) => d.type === 'builtin-drum-kit' || d.type === 'drum-kit');
            const kitDef = drumKitDevice
                ? getDrumKitDefByIndex(drumKitDevice.parameterValues.kit ?? drumKitDevice.parameterValues.kitId ?? 0)
                : null;

            // Only Toaster parent tracks play their own children's clips. If this
            // is a child track of a Toaster, skip note processing — the parent
            // will gather them.
            if (!instrumentControls && track.parentId && allTracks) {
                const parentTrack = allTracks.find((t) => t.id === track.parentId);
                if (parentTrack?.devices.some((d) => d.type === 'toaster')) {
                    continue;
                }
            }

            const synthParams =
                drumKit || kitDef || instrumentControls ? null : getSynthParamsFromDevices(track.devices);

            let noteCount = 0;

            type NoteEvent = { time: number; type: 'on' | 'off'; pitch: number; velocity: number; duration: number };
            const workletEvents: NoteEvent[] = [];

            for (let iter = 0; iter < maxIterations; iter++) {
                const iterOffset = iter * loopLen;

                for (const note of notes) {
                    if (note.startBeat >= loopLen) {
                        continue;
                    }
                    if (note.startBeat + note.duration <= 0) {
                        continue;
                    }

                    const noteAbsStart = clip.startBeat + iterOffset + note.startBeat;
                    if (noteAbsStart >= clip.endBeat) {
                        continue;
                    }

                    const startTime = beatToSeconds(noteAbsStart, defaultTempo, changes);
                    const noteEndBeat = Math.min(noteAbsStart + note.duration, clip.endBeat);
                    const endTime = beatToSeconds(noteEndBeat, defaultTempo, changes);
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

                const iterStartTime = beatToSeconds(iterStartBeat, defaultTempo, changes) + compensationDelay;
                if (iterStartTime >= durationSeconds) {
                    break;
                }

                const isFirstIter = iter === 0;
                const isLastIter = iter === maxIterations - 1 || iterStartBeat + loopLen >= clip.endBeat;

                const remainingBeats = Math.min(loopLen, clip.endBeat - iterStartBeat);
                const iterEndTime =
                    beatToSeconds(iterStartBeat + remainingBeats, defaultTempo, changes) + compensationDelay;
                const iterDurationSec = iterEndTime - iterStartTime;
                const playDuration = Math.min(iterDurationSec, buffer.duration / safeStretchRatio);

                if (playDuration <= 0) {
                    continue;
                }

                const source = offlineCtx.createBufferSource();
                source.buffer = buffer;
                if (safeStretchRatio !== 1) {
                    source.playbackRate.value = safeStretchRatio;
                }

                const startSec = Math.max(0, iterStartTime);
                const endSec = startSec + playDuration;

                const fadeGain = offlineCtx.createGain();
                source.connect(fadeGain);
                fadeGain.connect(trackInputNode);

                fadeGain.gain.setValueAtTime(clipGainValue, startSec);

                if (isFirstIter) {
                    if (clip.fadeInBeats > 0) {
                        const fadeInEndBeat = clip.startBeat + clip.fadeInBeats;
                        const fadeInEndSec = beatToSeconds(fadeInEndBeat, defaultTempo, changes);
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
                            beatToSeconds(fadeOutStartBeat, defaultTempo, changes) + compensationDelay;
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
                source.start(startSec, 0, playDuration);
            }
        }
    }
}
