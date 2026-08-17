import { isTauri, tauriInvoke } from '#/utils/tauriBridge';

type PitchEditSegment = {
    start_time_ms: number;
    end_time_ms: number;
    shift_semitones: number;
};

type CommitNativePitchEditInput<TContour> = {
    inputAudioPath: string;
    outputAudioPath: string;
    segments: PitchEditSegment[];
    contour: TContour;
};

type CommitNativePitchEditOutput = Promise<boolean>;

export async function commitNativePitchEdit<TContour>({
    inputAudioPath,
    outputAudioPath,
    segments,
    contour,
}: CommitNativePitchEditInput<TContour>): CommitNativePitchEditOutput {
    if (!isTauri()) {
        return false;
    }

    await tauriInvoke('commit_pitch_edit', {
        request: {
            inputAudioPath,
            outputAudioPath,
            segments,
            contour,
        },
    });

    return true;
}
