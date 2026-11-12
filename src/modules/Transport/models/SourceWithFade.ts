/**
 * A buffer source the scheduler tracks, with the handle its fade rides and —
 * for sources scheduled on the compensated clock (#4784) — the compensation it
 * was scheduled with, so a loop-seam fence can spare the tail it is still due.
 */
export type SourceWithFade = AudioBufferSourceNode & {
    fadeGainNode?: GainNode;
    compensationSeconds?: number;
    scheduledTrackId?: string;
    scheduledBufferId?: string;
    scheduledAudioKey?: string;
    scheduledFrozenKey?: string;
    scheduledFrozenOriginBeat?: number;
    scheduledFrozenWindow?: {
        anchorBeat: number;
        anchorTime: number;
        floorAnchorTime: number;
        floorBeat: number | null;
        initialFloor: boolean;
    };
    scheduledStartTime?: number;
    scheduledBufferOffset?: number;
    scheduledPlaybackRate?: number;
    scheduledEndTime?: number;
    scheduledStopTime?: number;
    scheduledMediaOwnerStopTime?: number;
};
