export type NoteBlob = {
    id: string;
    startTime: number; // in seconds
    endTime: number; // in seconds
    pitchCenterCents: number; // 0 is A440 if relative, or MIDI Note * 100
    pitchCurveCents: number[]; // the micro-pitch curve over time
    voicedConfidence: number;
    driftPercent: number;
    vibratoDepthPercent: number;
    vibratoRateHz: number;
    formantShiftCents: number;
    gainDb: number;
    muted: boolean;
};

export type KneadTrackState = {
    trackId: string;
    blobs: NoteBlob[];
    retuneSpeedMs: number;
    toleranceCents: number;
    toleranceTimeMs: number;
    humanizePercent: number;
    formantPreserve: boolean;
};
