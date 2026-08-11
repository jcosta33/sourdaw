export type DrumPreviewBranchesCapability = {
    schemaVersion: 1;
    baseRevision: string;
    actionType: 'createDrumPreviewBranches';
    sourceBranch: { branchId: string; rootHeads: string[] };
    section: { id: string; name: string; startBeat: number; endBeat: number; barCount: 8 };
    roles: {
        kick: { trackId: string; clipId: string; noteCount: number };
        snare: { trackId: string; clipId: string; noteCount: number };
        hiHat: { trackId: string; clipId: string; noteCount: number };
    };
    recipes: ['ghost-note-pocket', 'half-time-space', 'syncopated-hats'];
    protectedObjectIds: string[];
    allowedAction: {
        type: 'createDrumPreviewBranches';
        sectionId: string;
        candidateCount: 3;
        varyingRoles: ['snare', 'hi-hat'];
        requiredPayloadKeys: ['sectionId', 'candidateCount', 'varyingRoles'];
        forbiddenPayloadKeys: ['branchIds', 'rootDocIds', 'noteIds', 'kickNotes', 'snareNotes', 'hiHatNotes'];
    };
    constraints: {
        requireCompleteExactCandidateSet: true;
        requireFreshConfirmation: true;
        applicationAssignsBranchAndNoteIds: true;
        preserveKickExactly: true;
        preserveEveryUnrequestedObject: true;
        varyOnlySnareAndHiHatProgramming: true;
    };
};
