import { getTempoAtBeat, type TempoChange } from '../../models/TempoMap';

type ResolveTempoAtBeatInput = {
    changes: readonly TempoChange[];
    beat: number;
    defaultTempo: number;
};

/**
 * The flat tempo governing `beat` — the rate a *buffer-content* offset answers
 * to, as opposed to the integrated map a timeline placement answers to.
 *
 * Exposed as a use case because the offline renderer needs the very function
 * the live scheduler calls (`scheduleAudioClips` resolves its clip tempo this
 * way) and cannot import `models/` across the module boundary. The composition
 * root injects it through `configureOfflinePpqEndpointProjection`, the same
 * route `projectPpqEndpoints` already takes.
 */
export function resolveTempoAtBeat({ changes, beat, defaultTempo }: ResolveTempoAtBeatInput): number {
    return getTempoAtBeat(changes, beat, defaultTempo);
}
