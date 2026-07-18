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
    audioBufferId?: string;
    segments: PitchEditSegment[];
    contour: PitchContour;
};

type CommitPitchEditOutput = Promise<void>;

export async function commitPitchEdit({
    inputAudioPath,
    outputAudioPath,
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
        return;
    }

    if (!audioBufferId) {
        throw new Error('Could not get audio buffer for clip');
    }

    const buffer = audioBufferCache.get(audioBufferId) ?? null;
    if (!buffer) {
        throw new Error('Could not get audio buffer for clip');
    }

    processPitchEditWasm(buffer, segments, contour, outputAudioPath);
}
