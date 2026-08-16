import { commitNativePitchEdit } from '../../repositories/audioAnalysis/commit-native-pitch-edit';
import { audioBufferCache } from '../../stores/audioBufferCache';

import { processPitchEditWasm } from './processPitchEditWasm';

import type { PitchContour } from './analyzePitchForClip';

type PitchEditSegment = {
    start_time_ms: number;
    end_time_ms: number;
    shift_semitones: number;
};

type CommitPitchEditInput = {
    inputAudioPath: string;
    outputAudioPath: string;
    outputAudioBufferId: string;
    audioBufferId?: string;
    segments: PitchEditSegment[];
    contour: PitchContour;
};

/** `renderedAudioBufferId` names the cache entry holding the rendered audio, for
 *  the caller to repoint the clip at — playback resolves a clip through
 *  `audioBufferId`, never through its file path. It is null on the native path,
 *  which writes a file and decodes nothing into this realm's cache: there is no
 *  buffer to point at, and the clip's restored file pointer is the whole result. */
type CommitPitchEditOutput = Promise<{ renderedAudioBufferId: string | null }>;

export async function commitPitchEdit({
    inputAudioPath,
    outputAudioPath,
    outputAudioBufferId,
    audioBufferId,
    segments,
    contour,
}: CommitPitchEditInput): CommitPitchEditOutput {
    const didCommitNatively = await commitNativePitchEdit({
        inputAudioPath,
        outputAudioPath,
        segments,
        contour,
    });

    if (didCommitNatively) {
        return { renderedAudioBufferId: null };
    }

    if (!audioBufferId) {
        throw new Error('Could not get audio buffer for clip');
    }

    const buffer = audioBufferCache.get(audioBufferId) ?? null;
    if (!buffer) {
        throw new Error('Could not get audio buffer for clip');
    }

    processPitchEditWasm(buffer, segments, contour, outputAudioBufferId);
    return { renderedAudioBufferId: outputAudioBufferId };
}
