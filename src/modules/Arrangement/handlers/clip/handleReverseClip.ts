import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import { captureClipPitchAnalysis } from '#/modules/Knead/useCases';
import { readTempoAtBeat } from '#/modules/Transport/stores';
import { createHandler } from '#/utils/createHandler';

import { reverseClip } from '../../useCases/clipEditing/reverseClip';
import { reversedClipAudioOffsetBeats } from '../../useCases/clipEditing/reversedClipAudioOffsetBeats';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
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

function resolveRemappedAudioOffsetBeats(clip: {
    audioOffsetBeats?: number;
    startBeat: number;
    endBeat: number;
    audioBufferId?: string;
    stretchMode?: string;
    stretchRatio?: number;
}): number | undefined {
    if (!clip.audioBufferId) {
        return undefined;
    }
    const buffer = getCachedAudioBuffer({ bufferId: clip.audioBufferId });
    if (!buffer) {
        return undefined;
    }
    const clipTempo = readTempoAtBeat({ beat: clip.startBeat });
    return reversedClipAudioOffsetBeats({
        audioOffsetBeats: clip.audioOffsetBeats ?? 0,
        clipLengthBeats: clip.endBeat - clip.startBeat,
        bufferLength: buffer.length,
        sampleRate: buffer.sampleRate,
        tempo: clipTempo,
        stretchMode: clip.stretchMode,
        stretchRatio: clip.stretchRatio,
    });
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
        const analysis = captureClipPitchAnalysis(alpha.payload.clipId);
        const remappedAudioOffsetBeats = resolveRemappedAudioOffsetBeats(clip);
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
                    ...(remappedAudioOffsetBeats === undefined ? {} : { audioOffsetBeats: remappedAudioOffsetBeats }),
                    // The forward path clears pitch analysis, so redo restores none.
                },
            },
        };
    },
    undoable: true,
});
