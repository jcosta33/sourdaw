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
    readonly scope:
        | { readonly kind: 'master' | 'project' }
        | { readonly kind: 'tracks' | 'buses'; readonly ids: readonly string[] };
    readonly range: { readonly startBeat: number; readonly endBeat: number; readonly sectionId: string | null };
    readonly targets: readonly MeasuredPreviewTarget[];
    readonly batchContentHash: string;
};
