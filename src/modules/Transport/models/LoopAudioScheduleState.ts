import { type LoopAudioScheduleLifetime } from './LoopAudioScheduleLifetime';
import { type SourceWithFade } from './SourceWithFade';
import { type TempoChange } from './TempoMap';
import { type TransportState } from './TransportState';

export type AudioWindow = {
    passIndex: number;
    anchorBeat: number;
    anchorTime: number;
    fromBeat: number;
    toBeat: number;
    fromTime: number;
    toTime: number;
    passEndTime: number;
};
export type OwnedWindow = AudioWindow & {
    frozenMidi?: {
        trackId: string;
        clock: NonNullable<SourceWithFade['scheduledFrozenWindow']>;
        noncanonical: boolean;
    };
};
export type Pass = {
    index: number;
    end: number;
    audio: Set<string>;
    frozen: Set<string>;
    sources: AudioBufferSourceNode[];
    windows: OwnedWindow[];
    externalFrozenTracks: Set<string>;
};
export type Reconciliation = { pass: Pass; windows: OwnedWindow[]; next: number };
export type Coverage = LoopAudioScheduleLifetime['coverage'] & {
    recovery?: { window: OwnedWindow; elapsedMilliseconds: number };
};
export type Input = { context: BaseAudioContext; isCurrent: () => boolean; monotonicTime?: () => number };
export type Runtime = { context: BaseAudioContext; isCurrent: () => boolean; monotonicTime: () => number };
export type Refill = {
    transport: TransportState;
    changes: readonly TempoChange[];
    position: number;
    audioTime: number;
};
export type LoopAudioScheduleState = {
    passes: Map<number, Pass>;
    dirtyPasses: Map<Pass, Reconciliation>;
    anchor: { beat: number; time: number; firstEnd: number; duration: number } | null;
    geometry: unknown;
    programme: unknown;
    buffers: Map<string, AudioBuffer>;
    active: boolean;
    recoveredThisRefill: boolean;
    preparedThrough: number;
    currentInput: Refill | null;
    coverage: Coverage;
};
