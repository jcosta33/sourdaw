import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import { captureClipPitchAnalysis } from '#/modules/Knead/useCases';
import { readTempoAtBeat } from '#/modules/Transport/stores';
import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { type Clip } from '../../models/Track';
import { captureClipAudioSource } from '../../useCases/clipEditing/clipAudioSourceFields';
import { reverseClip } from '../../useCases/clipEditing/reverseClip';
import { reversedClipAudioOffsetBeats } from '../../useCases/clipEditing/reversedClipAudioOffsetBeats';
import { reversedClipAudioSource } from '../../useCases/clipEditing/reversedClipAudioSource';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { liveTempoTimeline } from '../../useCases/liveTempoTimeline';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

import { isReverseClipSessionEntry } from './isReverseClipSessionEntry';

function findAudioClip(clipId: string) {
    for (const track of getTrackStoreState()?.tracks ?? []) {
        const clip = track.clips.find((candidate) => candidate.id === clipId);
        if (clip) {
            return clip;
        }
    }
    return undefined;
}

/** The forward run's source remap, read before it runs so redo replays it exactly. */
function resolveReversedSource(clip: Clip) {
    const buffer = clip.audioBufferId ? getCachedAudioBuffer({ bufferId: clip.audioBufferId }) : undefined;
    if (!buffer) {
        return { audioOffsetBeats: undefined, audioSource: clip.audioOffsetSeconds === undefined ? undefined : null };
    }
    const clipTempo = readTempoAtBeat({ beat: clip.startBeat });
    return {
        audioOffsetBeats: reversedClipAudioOffsetBeats({
            audioOffsetBeats: clip.audioOffsetBeats ?? 0,
            clipLengthBeats: clip.endBeat - clip.startBeat,
            bufferLength: buffer.length,
            sampleRate: buffer.sampleRate,
            tempo: clipTempo,
            stretchMode: clip.stretchMode,
            stretchRatio: clip.stretchRatio,
        }),
        audioSource: reversedClipAudioSource(
            clip,
            buffer.length / buffer.sampleRate,
            liveTempoTimeline.secondsAtBeat,
            clipTempo
        ),
    };
}

function captureBeatAlias(value: number | undefined): { present: false } | { present: true; value: number } {
    if (value === undefined) {
        return { present: false };
    }
    return { present: true, value };
}

/** The batch is a singleton, so the live stores are the state this action plans against. */
function findRefusal(action: Extract<AppAction, { type: 'reverseClip' }>): string | null {
    const { clipId } = action.payload;
    const owner = getTrackStoreState()?.tracks.find((track) =>
        track.clips.some((candidate) => candidate.id === clipId)
    );
    const clip = owner?.clips.find((candidate) => candidate.id === clipId);
    if (!owner || !clip) {
        return `Clip "${clipId}" does not exist`;
    }
    if (clip.type !== 'audio' || !clip.audioBufferId) {
        return `Clip "${clipId}" is not an audio clip with audio to reverse`;
    }
    if (clip.locked) {
        return `Clip "${clipId}" is locked`;
    }
    if (owner.frozen === true) {
        return `Track "${owner.id}" is frozen`;
    }
    return findAudioRefusal(clip, action.payload.reversedBufferId);
}

function findAudioRefusal(clip: Clip, reversedBufferId: string | undefined): string | null {
    if (!clip.audioBufferId || !getCachedAudioBuffer({ bufferId: clip.audioBufferId })) {
        return `The audio of clip "${clip.id}" is not loaded`;
    }
    // The reverse caches its mirrored audio under this id, so an id already cached, the clip's own among
    // them, would overwrite audio another clip or this undo still needs.
    if (reversedBufferId !== undefined && getCachedAudioBuffer({ bufferId: reversedBufferId })) {
        return `Audio buffer "${reversedBufferId}" already exists, so it cannot hold the reversed audio`;
    }
    if (resolveReversedSource(clip).audioSource === null) {
        return `Clip "${clip.id}" cannot be mirrored while it loops; bounce it to audio first`;
    }
    return null;
}

export const handleReverseClip = createHandler<'reverseClip'>({
    batchExecution: 'singleton',
    validate: (action) => findRefusal(action) === null,
    validationRefusalReason: findRefusal,
    validateSessionEntry: isReverseClipSessionEntry,
    execute: (alpha) => {
        const didWrite = reverseClip(alpha.payload.clipId, alpha.payload.reversedBufferId);
        return toHandlerExecutionResult(didWrite);
    },
    describe: (alpha) => {
        // Reversing again is not the inverse. Each run mints a fresh buffer id, appends
        // another " (reversed)" to the name and drops the clip's pitch analysis, so a
        // second reverse restores the audio but leaves the metadata changed and the
        // user's Knead edits destroyed. Capture all three and put them back together.
        const clip = findAudioClip(alpha.payload.clipId);
        const reversedBufferId = alpha.payload.reversedBufferId;
        if (!clip || clip.type !== 'audio' || !clip.audioBufferId || !reversedBufferId) {
            return { label: 'Reverse clip', inverseAction: null };
        }
        const reversed = resolveReversedSource(clip);
        if (reversed.audioSource === null) {
            // The forward run refuses a canonical entry it cannot mirror.
            return { label: 'Reverse clip', inverseAction: null };
        }
        const analysis = captureClipPitchAnalysis(alpha.payload.clipId);
        const remappedAudioOffsetBeats = reversed.audioOffsetBeats;
        const originalAudioSource = captureClipAudioSource(clip);
        return {
            label: 'Reverse clip',
            inverseAction: {
                type: 'restoreReversedClip',
                payload: {
                    clipId: clip.id,
                    expectedAudioBufferId: reversedBufferId,
                    audioBufferId: clip.audioBufferId,
                    name: clip.name,
                    fadeInBeats: clip.fadeInBeats,
                    fadeOutBeats: clip.fadeOutBeats,
                    audioOffsetBeatsCapture: captureBeatAlias(clip.audioOffsetBeats),
                    // The forward run restamps the anchor at the clip's own start (the
                    // mirrored buffer is a fresh media basis), so undo must put the
                    // pre-reverse anchor back. Absent when the source was unanchored:
                    // the restamp keeps the key absent then, so leaving it out of the
                    // payload matches the restore's untouched default.
                    ...(clip.loopOriginBeat !== undefined ? { loopOriginBeat: clip.loopOriginBeat } : {}),
                    ...(originalAudioSource ? { audioSource: originalAudioSource } : {}),
                    ...analysis,
                },
            },
            redoAction: {
                type: 'restoreReversedClip',
                payload: {
                    clipId: clip.id,
                    expectedAudioBufferId: clip.audioBufferId,
                    audioBufferId: reversedBufferId,
                    name: `${clip.name} (reversed)`,
                    // The forward path mirrors the fades along with the audio.
                    fadeInBeats: clip.fadeOutBeats,
                    fadeOutBeats: clip.fadeInBeats,
                    // Redo replays the forward restamp: an anchored source re-anchors
                    // at its start; an unanchored one stays unanchored, so no key.
                    ...(clip.loopOriginBeat !== undefined ? { loopOriginBeat: clip.startBeat } : {}),
                    audioOffsetBeatsCapture: captureBeatAlias(remappedAudioOffsetBeats),
                    ...(reversed.audioSource ? { audioSource: reversed.audioSource } : {}),
                    // The forward path clears pitch analysis, so redo restores none.
                },
            },
        };
    },
    undoable: true,
});
