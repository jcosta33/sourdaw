type TrackEligibility = {
    acceptsClipAdd: boolean;
    acceptsClipUpdate: boolean;
    acceptsArm: boolean;
    acceptsRecording: boolean;
    acceptsDeviceAdd: boolean;
    acceptsDeviceUpdate: boolean;
    acceptsMidiFxAdd: boolean;
    acceptsMidiFxUpdate: boolean;
    removesMidiFxProjectResidue: boolean;
    acceptsInput: boolean;
    acceptsMonitoring: boolean;
    acceptsSend: boolean;
    acceptsOutput: boolean;
    acceptsRoutingEndpoint: boolean;
    acceptsFreeze: boolean;
    acceptsBounce: boolean;
    rendersTrackContent: boolean;
    createsLiveStrip: boolean;
    createsOfflineStrip: boolean;
    exportsStem: boolean;
};

type TrackEligibilityKind = 'audio' | 'midi' | 'bus' | 'master' | 'folder' | 'vca';

type LiveStripTrack = {
    kind: TrackEligibilityKind;
    devices: readonly { type: string }[];
};

const ELIGIBLE_FOR_ALL_AUDIO_BEARING_WRITES = {
    acceptsClipAdd: true,
    acceptsClipUpdate: true,
    acceptsArm: true,
    acceptsRecording: true,
    acceptsDeviceAdd: true,
    acceptsDeviceUpdate: true,
    acceptsMidiFxAdd: true,
    acceptsMidiFxUpdate: true,
    acceptsInput: true,
    acceptsMonitoring: true,
    acceptsSend: true,
    acceptsOutput: true,
    acceptsRoutingEndpoint: true,
    acceptsFreeze: true,
    acceptsBounce: true,
} as const;

const TRACK_ELIGIBILITY: Readonly<Record<TrackEligibilityKind, Readonly<TrackEligibility>>> = {
    audio: {
        ...ELIGIBLE_FOR_ALL_AUDIO_BEARING_WRITES,
        removesMidiFxProjectResidue: false,
        rendersTrackContent: true,
        createsLiveStrip: true,
        createsOfflineStrip: true,
        exportsStem: true,
    },
    midi: {
        ...ELIGIBLE_FOR_ALL_AUDIO_BEARING_WRITES,
        removesMidiFxProjectResidue: true,
        rendersTrackContent: true,
        createsLiveStrip: true,
        createsOfflineStrip: true,
        exportsStem: true,
    },
    bus: {
        ...ELIGIBLE_FOR_ALL_AUDIO_BEARING_WRITES,
        removesMidiFxProjectResidue: false,
        rendersTrackContent: false,
        createsLiveStrip: true,
        createsOfflineStrip: true,
        exportsStem: true,
    },
    master: {
        ...ELIGIBLE_FOR_ALL_AUDIO_BEARING_WRITES,
        removesMidiFxProjectResidue: false,
        rendersTrackContent: false,
        createsLiveStrip: true,
        createsOfflineStrip: true,
        exportsStem: false,
    },
    folder: {
        ...ELIGIBLE_FOR_ALL_AUDIO_BEARING_WRITES,
        removesMidiFxProjectResidue: false,
        rendersTrackContent: false,
        createsLiveStrip: false,
        createsOfflineStrip: false,
        exportsStem: false,
    },
    vca: {
        acceptsClipAdd: false,
        acceptsClipUpdate: false,
        acceptsArm: false,
        acceptsRecording: false,
        acceptsDeviceAdd: false,
        acceptsDeviceUpdate: false,
        acceptsMidiFxAdd: false,
        acceptsMidiFxUpdate: false,
        removesMidiFxProjectResidue: true,
        acceptsInput: false,
        acceptsMonitoring: false,
        acceptsSend: false,
        acceptsOutput: false,
        acceptsRoutingEndpoint: false,
        acceptsFreeze: false,
        acceptsBounce: false,
        rendersTrackContent: false,
        createsLiveStrip: false,
        createsOfflineStrip: false,
        exportsStem: false,
    },
};

export function getTrackEligibility(kind: TrackEligibilityKind): Readonly<TrackEligibility> {
    if (kind === 'audio') {
        return TRACK_ELIGIBILITY.audio;
    }
    if (kind === 'midi') {
        return TRACK_ELIGIBILITY.midi;
    }
    if (kind === 'bus') {
        return TRACK_ELIGIBILITY.bus;
    }
    if (kind === 'master') {
        return TRACK_ELIGIBILITY.master;
    }
    if (kind === 'folder') {
        return TRACK_ELIGIBILITY.folder;
    }
    return TRACK_ELIGIBILITY.vca;
}

export function shouldCreateLiveTrackStrip(track: LiveStripTrack): boolean {
    if (getTrackEligibility(track.kind).createsLiveStrip) {
        return true;
    }
    if (track.kind !== 'folder') {
        return false;
    }
    return track.devices.some((device) => device.type === 'toaster');
}
