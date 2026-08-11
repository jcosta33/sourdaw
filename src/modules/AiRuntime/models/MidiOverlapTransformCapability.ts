export type MidiOverlapTransformClip = {
    trackId: string;
    trackName: string;
    clipId: string;
    clipName: string;
    noteCount: number;
    shortOverlapCount: number;
};

export type MidiOverlapTransformCapability = {
    schemaVersion: 1;
    baseRevision: string;
    actionType: 'removeShortMidiOverlaps';
    tempo: number;
    maximumOverlapMs: 30;
    selectedClips: MidiOverlapTransformClip[];
    protectedClipIds: string[];
    allowedAction: {
        type: 'removeShortMidiOverlaps';
        exactClipIds: string[];
        maximumOverlapMs: 30;
        requiredPayloadKeys: ['clipId', 'maximumOverlapMs'];
        forbiddenPayloadKeys: ['notes', 'noteIds', 'durations', 'tempo', 'expectedNotes'];
    };
    constraints: {
        requireCompleteExactClipSet: true;
        requireFreshConfirmation: true;
        overlapGrouping: 'same-pitch-and-channel';
        thresholdComparison: 'strictly-less-than';
        preserveStartsPitchesVelocitiesChannelsExpressionAndArticulation: true;
    };
};
