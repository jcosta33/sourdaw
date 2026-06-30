import { invoke } from '@tauri-apps/api/core';

import { type PitchContour } from '#/modules/Knead/stores';
import { isTauri } from '#/utils/tauriBridge';

type PitchEditSegment = {
    start_time_ms: number;
    end_time_ms: number;
    shift_semitones: number;
};

type CommitNativePitchEditInput = {
    inputAudioPath: string;
    outputAudioPath: string;
    segments: PitchEditSegment[];
    contour: PitchContour;
};

type CommitNativePitchEditOutput = Promise<boolean>;

export async function commitNativePitchEdit({
    inputAudioPath,
    outputAudioPath,
    segments,
    contour,
}: CommitNativePitchEditInput): CommitNativePitchEditOutput {
    if (!isTauri()) {
        return false;
    }

    await invoke('commit_pitch_edit', {
        request: {
            inputAudioPath,
            outputAudioPath,
            segments,
            contour,
        },
    });

    return true;
}
