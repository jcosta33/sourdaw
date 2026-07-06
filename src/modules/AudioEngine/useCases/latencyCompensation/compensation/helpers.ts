export const WORKLET_BLOCK_SIZE = 128;

export const deviceLatencyMap: Record<string, number> = {
    'builtin-eq': 0,
    'builtin-compressor': 0,
    'builtin-reverb': 0,
    'builtin-delay': 0,
    'builtin-gain': 0,
    'builtin-sidechain-compressor': (WORKLET_BLOCK_SIZE / 48000) * 1000,
};
