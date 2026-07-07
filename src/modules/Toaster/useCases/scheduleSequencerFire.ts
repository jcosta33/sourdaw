import { type SequencerPlaybackState } from './getSequencerPlaybackState';

type ScheduleSequencerFireInput = {
    seqState: SequencerPlaybackState;
    fire: () => void;
    delayMs: number;
};

export function scheduleSequencerFire({ seqState, fire, delayMs }: ScheduleSequencerFireInput): void {
    const id = setTimeout(() => {
        seqState.pendingFireIds.delete(id);
        fire();
    }, delayMs);
    seqState.pendingFireIds.add(id);
}
