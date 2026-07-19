export type SequencerPlaybackState = {
    running: boolean;
    fillActive: boolean;
    playCount: number;
    nextTickTime: number;
    timeoutId: ReturnType<typeof setTimeout> | null;
    preScheduledStep: number | null;
    lastBpm: number | null;
    // Microtiming / retrigger fires scheduled by ticks. Tracked per device so
    // stopSequencer can cancel ghost hits that would otherwise fire after Stop
    // (clearing the next-tick timeoutId alone leaves these armed).
    pendingFireIds: Set<ReturnType<typeof setTimeout>>;
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
            pendingFireIds: new Set(),
        };
        sequencerPlaybackStates.set(deviceId, state);
    }
    return state;
}
