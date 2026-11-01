import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import { captureClipPitchAnalysis } from '#/modules/Knead/useCases';
import { readTempoAtBeat } from '#/modules/Transport/stores';
import { createHandler } from '#/utils/createHandler';

import { type Clip } from '../../models/Track';
import { captureClipAudioSource } from '../../useCases/clipEditing/clipAudioSourceFields';
import { reverseClip } from '../../useCases/clipEditing/reverseClip';
import { reversedClipAudioOffsetBeats } from '../../useCases/clipEditing/reversedClipAudioOffsetBeats';
import { reversedClipAudioSource } from '../../useCases/clipEditing/reversedClipAudioSource';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { liveTempoTimeline } from '../../useCases/liveTempoTimeline';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

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
        audioSource: reversedClipAudioSource(clip, buffer.length / buffer.sampleRate, liveTempoTimeline.secondsAtBeat),
    };
}

export const handleReverseClip = createHandler<'reverseClip'>({
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
                    audioOffsetBeats: clip.audioOffsetBeats ?? 0,
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
                    ...(remappedAudioOffsetBeats === undefined ? {} : { audioOffsetBeats: remappedAudioOffsetBeats }),
                    ...(reversed.audioSource ? { audioSource: reversed.audioSource } : {}),
                    // The forward path clears pitch analysis, so redo restores none.
                },
            },
        };
    },
    undoable: true,
});
