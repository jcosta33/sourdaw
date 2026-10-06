import { type MeasuredMetricEntry } from './MeasuredPreview';
import { type SemanticCommandListRoleFamily } from './SemanticCommandList';

export type VibeRunBeatWindow = {
    readonly startBeat: number;
    readonly endBeat: number;
};

/**
 * One `analysis.measure` result as the decomposition reads it: the beat window it rendered and each
 * rendered target's figures keyed by metric id. It is the `analysis-measurement` receipt's `range`
 * and `targets`, so a receipt's data is passed straight in.
 *
 * `range.sectionId` names a section only when the call asked for one; an explicit beat window
 * carries `null`, and so does a window that happens to match a section. It never means the whole
 * project, which `analysis.measure` has no range for, so a figure answers for a section only through
 * the window it was rendered over.
 */
export type VibeRunMeasurement = {
    readonly range: VibeRunBeatWindow & { readonly sectionId: string | null };
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

/**
 * One target's measured figures standing for one section, limited to the metrics the batch expects to
 * move. `window` is the beat range the figures were rendered over: the section's own, or a wider one
 * that fully contains it.
 */
export type VibeRunBaseline = {
    readonly targetId: string;
    readonly sectionId: string;
    readonly window: VibeRunBeatWindow;
    readonly measurements: Readonly<Partial<Record<string, MeasuredMetricEntry>>>;
};

export type VibeRunBatch = {
    readonly id: string;
    /** One-based position in the run: batches run, and are approved, in this order. */
    readonly ordinal: number;
    readonly objective: VibeRunBatchObjective;
    readonly targetIds: readonly string[];
    readonly expectedDeltas: readonly VibeRunExpectedDelta[];
    /** The commands the batch's recipes expand to over all its targets; never above the batch cap. */
    readonly commandCount: number;
    readonly baselines: readonly VibeRunBaseline[];
    /** Targets no supplied measurement stands for in any section; their figures are read when the batch is previewed. */
    readonly unmeasuredTargetIds: readonly string[];
    /** A target and section two or more measurements answer for equally; none of their figures stands. */
    readonly baselineConflicts: readonly { readonly targetId: string; readonly sectionId: string }[];
};

export type VibeRunExcludedTargetReason =
    'protected' | 'folder' | 'frozen' | 'unclassified-role' | 'no-applicable-recipe';

/** A track no batch touches, and why: the project guards it, or `recipe.expand` would refuse it. */
export type VibeRunExcludedTarget = {
    readonly targetId: string;
    readonly reason: VibeRunExcludedTargetReason;
};

export type VibeRunUnplannedRole = {
    readonly role: SemanticCommandListRoleFamily;
    readonly reason: 'no-expected-deltas' | 'target-exceeds-batch-cap';
    readonly targetIds: readonly string[];
};

export type VibeRunPlan = {
    readonly schemaVersion: 1;
    /** The revision of the production brief the plan consulted; `null` when the project holds none. */
    readonly briefRevision: number | null;
    readonly batches: readonly VibeRunBatch[];
    readonly excludedTargets: readonly VibeRunExcludedTarget[];
    readonly unplannedRoles: readonly VibeRunUnplannedRole[];
};
