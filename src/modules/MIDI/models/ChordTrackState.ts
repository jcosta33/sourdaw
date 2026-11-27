import { type ChordEvent } from './ChordEvent';

export type ChordTrackState = {
    enabled: boolean;
    events: ChordEvent[];
};

/** A chord track read without the right to change it, such as an action payload snapshot. */
export type ReadonlyChordTrackState = {
    readonly enabled: boolean;
    readonly events: readonly Readonly<ChordEvent>[];
};
