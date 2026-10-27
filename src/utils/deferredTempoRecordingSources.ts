import { valuesEqual } from './structuralEquality';
import {
    captureTempoSourceOwnerValue,
    normalizeTempoSourceOwnerContext,
    type TempoSourceOwner,
} from './tempoAudioSourcePromotion';

type SourceContext = { readonly tracks?: unknown; readonly takeLanes?: unknown };
export type DeferredTempoRecordingSources = readonly {
    readonly owner: TempoSourceOwner;
    readonly fields: readonly string[];
    readonly value: NonNullable<ReturnType<typeof captureTempoSourceOwnerValue>>;
    readonly staged: NonNullable<ReturnType<typeof captureTempoSourceOwnerValue>>;
}[];

/** Only privately authenticated recording owners can be deferred. Match every
 * captured raw facet first; this projection changes coverage, never the document. */
export function withoutDeferredTempoRecordingSources<Context extends SourceContext>(
    context: Context,
    sources?: DeferredTempoRecordingSources
): Context | null {
    if (!sources?.length) {
        return context;
    }
    if (
        sources.some((source) => {
            const actual = captureTempoSourceOwnerValue(context, source.owner, source.fields);
            return !valuesEqual(actual, source.value) && !valuesEqual(actual, source.staged);
        })
    ) {
        return null;
    }
    return normalizeTempoSourceOwnerContext(context, {
        rows: sources.map((source) => ({
            owner: source.owner,
            fields: source.fields,
            before: source.value,
            read: { present: false },
            after: source.staged,
        })),
    });
}
