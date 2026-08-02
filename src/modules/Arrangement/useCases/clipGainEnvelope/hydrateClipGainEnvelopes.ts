import { sanitizeClipGainEnvelopes, setAllEnvelopes } from '../../stores/gainEnvelopeStore';

/**
 * Load persisted clip gain envelopes into the live store, replacing whatever
 * the previous project left there.
 *
 * Called unconditionally by the project-load path, including with `undefined`,
 * so envelopes keyed by the outgoing project's clip ids cannot survive into the
 * incoming one.
 */
export function hydrateClipGainEnvelopes(persistedEnvelopes: unknown): void {
    setAllEnvelopes(sanitizeClipGainEnvelopes(persistedEnvelopes));
}
