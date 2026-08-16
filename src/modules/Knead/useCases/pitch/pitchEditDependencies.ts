import { type PitchContour } from '../../stores/kneadStore';

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

/** The render reports which cache entry now holds the edited audio, so the commit
 *  can repoint the clip at it. Null when the render wrote a file without decoding
 *  it into this realm (the native path) — there is nothing to point at. */
type CommitPitchEditResult = { renderedAudioBufferId: string | null };

export type PitchEditDependencies = {
    commitPitchEdit: (input: CommitPitchEditInput) => Promise<CommitPitchEditResult>;
};

export let dependencies: PitchEditDependencies | null = null;

export function setPitchEditDependencies(deps: PitchEditDependencies): void {
    dependencies = deps;
}
