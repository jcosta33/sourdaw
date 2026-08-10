export type SidechainRoutingTarget = {
    trackId: string;
    trackName: string;
    trackRole: 'bass';
    roleEvidence: string;
    deviceId: string;
    deviceName: string;
    deviceType: string;
    targetParameterId: string;
};

export type SidechainRoutingProtectedTarget = {
    id: string;
    name: string;
    reason: 'already-routed' | 'frozen' | 'locked' | 'non-bass' | 'unsupported-device';
};

export type SidechainRoutingCapability = {
    schemaVersion: 1;
    baseRevision: string;
    actionType: 'addSidechainRoute';
    source: {
        trackId: string;
        trackName: string;
        role: 'kick';
        roleEvidence: string;
    };
    targets: SidechainRoutingTarget[];
    protectedTargets: SidechainRoutingProtectedTarget[];
    allowedAction: {
        type: 'addSidechainRoute';
        exactRoutes: Array<{ sourceTrackId: string; targetTrackId: string; targetDeviceId: string }>;
        requiredPayloadKeys: ['sourceTrackId', 'targetTrackId', 'targetDeviceId'];
    };
    constraints: {
        requireCompleteExactTargetSet: true;
        requireFreshConfirmation: true;
        preserveProtectedTargets: true;
    };
};
