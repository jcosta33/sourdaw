export type DrumRoutingRole = 'kick' | 'snare' | 'hi-hat' | 'tom' | 'cymbal' | 'percussion' | 'overhead' | 'room';

export type DrumRoutingCandidate = {
    id: string;
    name: string;
    kind: 'audio' | 'midi';
    role: DrumRoutingRole;
    roleEvidence: string;
    currentOutputId: string;
    frozen: boolean;
    locked: boolean;
};

export type DrumRoutingProtectedTrack = {
    id: string;
    name: string;
    kind: string;
    role: string;
    roleEvidence: string;
    currentOutputId: string | null;
    frozen: boolean;
    locked: boolean;
};

export type DrumRoutingCapability = {
    schemaVersion: 1;
    baseRevision: string;
    actionType: 'setTrackOutput';
    bus: { id: string; name: string; kind: 'bus' };
    candidateDrums: DrumRoutingCandidate[];
    protectedReturn: DrumRoutingProtectedTrack;
    protectedNonDrums: DrumRoutingProtectedTrack[];
    allowedAction: {
        type: 'setTrackOutput';
        exactTargetIds: string[];
        outputId: string;
        requiredPayloadKeys: ['trackId', 'outputId'];
        forbiddenTargetIds: string[];
    };
    constraints: {
        requireCompleteExactTargetSet: true;
        requireFreshConfirmation: true;
        preserveProtectedTracks: true;
    };
};
