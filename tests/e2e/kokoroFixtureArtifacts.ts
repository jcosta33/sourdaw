export const KOKORO_BASE =
    'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231';

// The one pinned list: the real-model spec verifies it and scripts/prefetchKokoroFixtures.ts
// downloads it, so CI never fetches the model inside a test timeout.
export const KOKORO_ARTIFACTS = [
    {
        name: 'model_q8f16.onnx',
        url: `${KOKORO_BASE}/onnx/model_q8f16.onnx`,
        size: 86_033_585,
        sha256: '04c658aec1b6008857c2ad10f8c589d4180d0ec427e7e6118ceb487e215c3cd0',
    },
    {
        name: 'af_heart.bin',
        url: `${KOKORO_BASE}/voices/af_heart.bin`,
        size: 522_240,
        sha256: 'd583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b',
    },
] as const;

export type KokoroArtifact = (typeof KOKORO_ARTIFACTS)[number];
