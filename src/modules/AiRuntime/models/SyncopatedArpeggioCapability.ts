export type SyncopatedArpeggioChordWindow = {
    startBeat: number;
    endBeat: number;
    pitches: number[];
};

export type SyncopatedArpeggioCapability = {
    schemaVersion: 1;
    baseRevision: string;
    actionType: 'arpeggiate';
    target: {
        trackId: string;
        trackName: string;
        clipId: string;
        clipName: string;
        sourceNoteCount: number;
        addedNoteCount: number;
        chordWindows: SyncopatedArpeggioChordWindow[];
    };
    protectedClipIds: string[];
    allowedAction: {
        type: 'arpeggiate';
        clipId: string;
        pattern: 'up';
        rate: 8;
        octaves: 1;
        gate: 50;
        requiredPayloadKeys: ['clipId', 'pattern', 'rate', 'octaves', 'gate'];
        forbiddenPayloadKeys: ['notes', 'noteIds', 'expectedNotes', 'addedNotes', 'mode', 'seed'];
    };
    constraints: {
        requireFreshConfirmation: true;
        requireExactSelectedClip: true;
        addWithoutReplacingSourceNotes: true;
        preserveAbsoluteVoicing: true;
        preserveChordBoundaries: true;
        rhythm: 'offbeat-eighths';
    };
};
