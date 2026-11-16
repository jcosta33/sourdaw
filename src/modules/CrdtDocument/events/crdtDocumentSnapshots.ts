/** Exact root publication and source member, attached only after the producer commits. */
export type CommandSourceProof = { changeHash: string; memberId: string };

export type DrumPreviewRecipe = 'ghost-note-pocket' | 'half-time-space' | 'syncopated-hats';

export type DrumPreviewExpressionPointSnapshot = { readonly offsetBeats: number; readonly value: number };

export type DrumPreviewNoteExpressionSnapshot = {
    readonly pressure?: DrumPreviewExpressionPointSnapshot[];
    readonly slide?: DrumPreviewExpressionPointSnapshot[];
    readonly pitchBend?: DrumPreviewExpressionPointSnapshot[];
};

/**
 * A MIDI note as a drum preview plan carries it. The kernel may not import MIDI,
 * so it declares the note's full wire shape itself: the generated argument
 * schema closes every object, so a narrower shape would refuse a note MIDI
 * writes. MIDI pins this type equal to its own note snapshot in a spec.
 */
export type DrumPreviewNoteSnapshot = {
    readonly id: string;
    readonly pitch: number;
    readonly startBeat: number;
    readonly duration: number;
    readonly velocity: number;
    readonly probability?: number;
    readonly pressure?: number;
    readonly slide?: number;
    readonly pitchBend?: number;
    readonly pitchBendRangeSemitones?: number;
    readonly channel?: number;
    readonly articulation?: string;
    readonly expression?: DrumPreviewNoteExpressionSnapshot;
    /** Original recording pass, absent on legacy and manually edited notes. */
    readonly recordingPassIndex?: number;
};

export type DrumPreviewSourceClipSnapshot = {
    readonly trackId: string;
    readonly trackName: string;
    readonly expectedTrackFrozen: boolean;
    readonly clipId: string;
    readonly clipName: string;
    readonly expectedClipLocked: boolean;
    readonly expectedNotes: readonly DrumPreviewNoteSnapshot[];
};

export type DrumPreviewCandidateSnapshot = {
    readonly branchId: string;
    readonly branchName: string;
    readonly rootDocId: string;
    readonly recipe: DrumPreviewRecipe;
    readonly snareNotes: readonly DrumPreviewNoteSnapshot[];
    readonly hiHatNotes: readonly DrumPreviewNoteSnapshot[];
};
