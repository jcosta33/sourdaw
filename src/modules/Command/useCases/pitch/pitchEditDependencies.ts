import { type PitchContour } from '#/modules/Knead/stores';

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

type PitchEditDependencies = {
    commitPitchEdit: (input: CommitPitchEditInput) => Promise<void>;
};

let dependencies: PitchEditDependencies | null = null;

export function setPitchEditDependencies(deps: PitchEditDependencies): void {
    dependencies = deps;
}

export function getPitchEditDependencies(): PitchEditDependencies {
    if (!dependencies) {
        throw new Error('Pitch edit dependencies not initialized');
    }

    return dependencies;
}
