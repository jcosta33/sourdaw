import { type TempoMapRow } from './tempoMapRowPlan';

export type TempoSourceClock = {
    readonly tempo: number;
    readonly changes: readonly TempoMapRow[];
};
