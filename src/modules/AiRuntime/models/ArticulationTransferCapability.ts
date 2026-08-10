export type ArticulationTransferNotePair = {
    sourceNoteId: string;
    targetNoteId: string;
    sourceArticulation: string | null;
    currentTargetArticulation: string | null;
    relativeStartBeat: number;
    duration: number;
    voiceOrdinal: number;
};

export type ArticulationTransferClipPair = {
    trackId: string;
    trackName: string;
    sourceClipId: string;
    sourceClipName: string;
    targetClipId: string;
    targetClipName: string;
    notePairs: ArticulationTransferNotePair[];
};

export type ArticulationTransferCapability = {
    schemaVersion: 1;
    baseRevision: string;
    actionType: 'copyMidiArticulations';
    sourceSection: { id: string; name: string; startBeat: number; endBeat: number };
    targetSection: { id: string; name: string; startBeat: number; endBeat: number };
    clipPairs: ArticulationTransferClipPair[];
    protectedClipIds: string[];
    allowedAction: {
        type: 'copyMidiArticulations';
        exactClipPairs: Array<{ sourceClipId: string; targetClipId: string }>;
        requiredPayloadKeys: ['sourceClipId', 'targetClipId'];
        forbiddenPayloadKeys: ['pitch', 'velocity', 'startBeat', 'duration', 'articulation', 'notePairs'];
    };
    constraints: {
        requireCompleteExactClipPairSet: true;
        requireFreshConfirmation: true;
        preservePitchVelocityTimingAndExpression: true;
    };
};
