import { getTempoAtBeat } from '../../models/TempoMap';

type ResolveTempoAtBeatInput = {
    changes: ReadonlyArray<{ id: string; beat: number; tempo: number; curve: 'instant' | 'linear' }>;
    beat: number;
    defaultTempo: number;
};

/**
 * Resolve the tempo in force at `beat` from an already-read tempo map.
 *
 * The store-reading sibling is `getTempoAtPlayhead`. This variant exists for
 * React consumers: they already subscribe to both stores, and passing the
 * subscribed values in keeps the result a visible function of reactive inputs
 * instead of a zero-argument call the compiler may cache across renders.
 */
export function resolveTempoAtBeat(input: ResolveTempoAtBeatInput): number {
    return getTempoAtBeat(input.changes, input.beat, input.defaultTempo);
}
