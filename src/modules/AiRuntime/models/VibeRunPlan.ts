import { type MeasuredMetricEntry } from './MeasuredPreview';
import { type SemanticCommandListRoleFamily } from './SemanticCommandList';

/**
 * One `analysis.measure` result as the decomposition reads it: the beat range it covered (a
 * section, or `null` for the whole project) and each rendered target's figures keyed by metric id.
 * It is the `analysis-measurement` receipt's `range` and `targets` narrowed to what a baseline
 * needs, so a receipt's data is passed straight in.
 */
export type VibeRunMeasurement = {
    readonly range: { readonly sectionId: string | null };
    readonly targets: readonly {
        readonly targetId: string;
        readonly measurements: Readonly<Partial<Record<string, MeasuredMetricEntry>>>;
    }[];
};

export type VibeRunSectionScope = {
    readonly id: string;
    readonly startBeat: number;
    readonly endBeat: number;
};

/** The metric a batch is expected to move, why, and which way. `band` is set only on a band-wise metric. */
export type VibeRunExpectedDelta = {
    readonly descriptor: string;
    readonly metric: string;
    readonly band: string | null;
    readonly direction: 'increase' | 'decrease' | 'hold';
};

/** What one batch is for: the characters it pursues on one role family, over which sections, by which recipes. */
export type VibeRunBatchObjective = {
    readonly descriptors: readonly string[];
    readonly role: SemanticCommandListRoleFamily;
    /** The project's sections in timeline order; empty when the project has none and the scope is the whole project. */
    readonly sections: readonly VibeRunSectionScope[];
    readonly sectionGoals: readonly { readonly sectionId: string; readonly statement: string }[];
    readonly recipeIds: readonly string[];
};

/** One target's measured figures over one range, limited to the metrics the batch expects to move. */
export type VibeRunBaseline = {
    readonly targetId: string;
    readonly sectionId: string | null;
    readonly measurements: Readonly<Partial<Record<string, MeasuredMetricEntry>>>;
};

export type VibeRunBatch = {
    readonly id: string;
    /** One-based position in the run: batches run, and are approved, in this order. */
    readonly ordinal: number;
    readonly objective: VibeRunBatchObjective;
    readonly targetIds: readonly string[];
    readonly expectedDeltas: readonly VibeRunExpectedDelta[];
    readonly baselines: readonly VibeRunBaseline[];
    /** Targets no supplied measurement covers; their figures are read when the batch is previewed. */
    readonly unmeasuredTargetIds: readonly string[];
};

export type VibeRunUnplannedRole = {
    readonly role: SemanticCommandListRoleFamily;
    readonly reason: 'no-expected-deltas';
    readonly targetIds: readonly string[];
};

export type VibeRunPlan = {
    readonly schemaVersion: 1;
    /** The revision of the production brief the plan consulted; `null` when the project holds none. */
    readonly briefRevision: number | null;
    readonly batches: readonly VibeRunBatch[];
    /** Tracks a production-brief lock names; no batch touches them. */
    readonly lockedTargetIds: readonly string[];
    /** Tracks whose canonical role belongs to no role family, so no recipe addresses them. */
    readonly unclassifiedTargetIds: readonly string[];
    readonly unplannedRoles: readonly VibeRunUnplannedRole[];
};
