export type SequencerPlaybackState = {
    running: boolean;
    fillActive: boolean;
    playCount: number;
    nextTickTime: number;
    timeoutId: ReturnType<typeof setTimeout> | null;
    preScheduledStep: number | null;
    lastBpm: number | null;
};

const sequencerPlaybackStates = new Map<string, SequencerPlaybackState>();

export function getSequencerPlaybackState(deviceId: string): SequencerPlaybackState {
    let state = sequencerPlaybackStates.get(deviceId);
    if (!state) {
        state = {
            running: false,
            fillActive: false,
            playCount: 0,
            nextTickTime: 0,
            timeoutId: null,
            preScheduledStep: null,
            lastBpm: null,
        };
        sequencerPlaybackStates.set(deviceId, state);
    }
    return state;
}
