import { type AdoptedRecipe } from './AdoptedRecipe';

/** Only successful application renders can supply these artifact identities. */
export type MetricPreviewProvenance = {
    readonly origin: 'planner' | 'approval-preview';
    readonly callId: string;
    readonly turn: number;
    readonly runId: string;
    readonly targets: readonly {
        readonly targetId: string;
        readonly baseline: {
            readonly route: 'mixdown' | 'isolated-subgraph';
            readonly artifact: { readonly contentAddress: string };
        };
        readonly preview: {
            readonly route: 'mixdown' | 'isolated-subgraph';
            readonly artifact: { readonly contentAddress: string };
        };
    }[];
};

/** One objective figure as an agent measurement reports it: read from the audio, or why it could not be. */
export type MeasuredMetricEntry =
    | {
          readonly status: 'measured';
          readonly metricVersion: 1;
          readonly unit: string;
          readonly value: number | boolean | readonly number[] | Readonly<Record<string, number>>;
          readonly confidence: 'exact' | 'estimated';
      }
    | { readonly status: 'unavailable'; readonly reason: string };

/** `preview − baseline` for one metric, or the typed reason the two do not subtract. */
export type MeasuredMetricDelta =
    | { readonly status: 'compared'; readonly delta: number; readonly unit: string }
    | { readonly status: 'incomparable'; readonly reason: string };

/** One rendered target of a preview measurement, in both documents, keyed by metric id. */
export type MeasuredPreviewTarget = {
    readonly targetId: string;
    readonly targetKind: 'master' | 'track' | 'bus';
    readonly baseline: Readonly<Partial<Record<string, MeasuredMetricEntry>>>;
    readonly preview: Readonly<Partial<Record<string, MeasuredMetricEntry>>>;
    readonly deltas: Readonly<Partial<Record<string, MeasuredMetricDelta>>>;
};

/**
 * What one `analysis.measure` call with `subject: 'preview'` measured: the scope and beat range it
 * rendered, and for each target the live project's figures, the isolated preview's, and their
 * deltas. Figures only; the renders stay in the application's measurement retention.
 *
 * `batchContentHash` is the content hash of the exact command batch the preview rendered. The
 * figures describe that batch and no other: an approval carries them only while the batch it holds
 * hashes the same.
 */
export type MeasuredPreview = {
    /** App-only source projection; legacy figures without actual renders cannot approve an acoustic goal. */
    readonly provenance?: MetricPreviewProvenance;
    /** Application-authored identity of the retained expansion this exact preview measured. */
    readonly recipeSource?: AdoptedRecipe;
    readonly scope:
        | { readonly kind: 'master' | 'project' }
        | { readonly kind: 'tracks' | 'buses'; readonly ids: readonly string[] };
    readonly range: { readonly startBeat: number; readonly endBeat: number; readonly sectionId: string | null };
    readonly targets: readonly MeasuredPreviewTarget[];
    readonly batchContentHash: string;
    /** The live project revision the baseline was rendered at: the figures describe that mix and no later one. */
    readonly revision: string;
};
