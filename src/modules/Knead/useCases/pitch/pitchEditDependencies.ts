import { type PitchContour } from '../../stores/kneadStore';

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

export type PitchEditDependencies = {
    commitPitchEdit: (input: CommitPitchEditInput) => Promise<void>;
};

export let dependencies: PitchEditDependencies | null = null;

export function setPitchEditDependencies(deps: PitchEditDependencies): void {
    dependencies = deps;
}
