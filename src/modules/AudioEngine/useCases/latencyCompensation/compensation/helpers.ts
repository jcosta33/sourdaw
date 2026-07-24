export const WORKLET_BLOCK_SIZE = 128;

/**
 * RT-6 — `DynamicsCompressorNode` applies an internal lookahead pre-delay that
 * no Web Audio API surface exposes: there is no `latency` property and the node
 * does not report through `externalLatencyRegistry` the way a WASM or native
 * device does. Blink fixes that pre-delay at 6 ms independent of sample rate,
 * so it is carried here as a documented platform constant rather than a
 * measurement, and feeds the *same* `getDeviceLatencyMs` surface every other
 * device reports on. Without it PDC reads these devices as zero-latency and the
 * tracks hosting them drift ~6 ms (twice that on a limiter + de-esser chain)
 * against the rest of the mix, live and offline alike.
 *
 * Revisit if the API ever exposes the real figure; a queryable value should
 * replace this constant rather than be added on top of it.
 */
export const DYNAMICS_COMPRESSOR_LOOKAHEAD_MS = 6;

export const deviceLatencyMap: Record<string, number> = {
    'builtin-eq': 0,
    'builtin-compressor': DYNAMICS_COMPRESSOR_LOOKAHEAD_MS,
    'builtin-limiter': DYNAMICS_COMPRESSOR_LOOKAHEAD_MS,
    'builtin-deesser': DYNAMICS_COMPRESSOR_LOOKAHEAD_MS,
    'builtin-reverb': 0,
    'builtin-delay': 0,
    'builtin-gain': 0,
    'builtin-sidechain-compressor': (WORKLET_BLOCK_SIZE / 48000) * 1000,
};
