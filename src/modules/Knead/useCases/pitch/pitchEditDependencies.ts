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
    /** The live settings the bake must reproduce (#2058): the render replaces
     *  the clip's audio, so anything omitted here is dropped for good. */
    retuneSpeedMs: number;
    formantPreserve: boolean;
};

/** The render reports which cache entry now holds the edited audio, so the commit
 *  can repoint the clip at it. Null when the render wrote a file without decoding
 *  it into this realm (the native path) — there is nothing to point at. */
type CommitPitchEditResult = { renderedAudioBufferId: string };

export type PitchEditDependencies = {
    commitPitchEdit: (input: CommitPitchEditInput) => Promise<CommitPitchEditResult>;
};

let registeredDependencies: PitchEditDependencies | null = null;

/** Stores the implementation; a later fill replaces an earlier one. */
export function setPitchEditDependencies(deps: PitchEditDependencies): void {
    registeredDependencies = deps;
}

/**
 * The registered renderer. Reading before registration throws rather than
 * committing a pitch edit that was never rendered.
 */
export const pitchEditDependenciesPort = {
    read(): PitchEditDependencies {
        if (registeredDependencies === null) {
            throw new Error(
                'pitchEditDependenciesPort.read: pitch edit dependencies are not registered; call setPitchEditDependencies() from #/app/bootstrap (bootstrap does this)'
            );
        }
        return registeredDependencies;
    },
};
