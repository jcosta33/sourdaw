const KOKORO_REVISION = '1939ad2a8e416c0acfeecc08a694d14ef25f2231';
const KOKORO_BASE_URL = `https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/${KOKORO_REVISION}`;

export const KOKORO_MODEL_ARTIFACT = Object.freeze({
    id: 'kokoro-82m-q8-1939ad2a',
    path: 'onnx/model_q8f16.onnx',
    sizeBytes: 86_033_585,
    sha256: '04c658aec1b6008857c2ad10f8c589d4180d0ec427e7e6118ceb487e215c3cd0',
    url: `${KOKORO_BASE_URL}/onnx/model_q8f16.onnx`,
});

export const KOKORO_VOICE_ARTIFACTS = [
    {
        id: 'af_heart',
        name: 'Heart',
        gender: 'female',
        accent: 'american',
        sha256: 'd583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b',
    },
    {
        id: 'af_bella',
        name: 'Bella',
        gender: 'female',
        accent: 'american',
        sha256: 'f69d836209b78eb8c66e75e3cda491e26ea838a3674257e9d4e5703cbaf55c8b',
    },
    {
        id: 'af_sarah',
        name: 'Sarah',
        gender: 'female',
        accent: 'american',
        sha256: '4409fbc125afabacc615d94db5398d847006a737b0247d6892b7a9a0007a2f0a',
    },
    {
        id: 'af_nicole',
        name: 'Nicole',
        gender: 'female',
        accent: 'american',
        sha256: 'cd2191ab31b914ed7b318416b0e4440fdf392ddad9106a060819aa600a64f59a',
    },
    {
        id: 'af_sky',
        name: 'Sky',
        gender: 'female',
        accent: 'american',
        sha256: '4435255c9744f3f31659e0d714ab7689bf65d9e77ec1cce060f083912614f0b9',
    },
    {
        id: 'am_adam',
        name: 'Adam',
        gender: 'male',
        accent: 'american',
        sha256: '162b035ed91cfc48b6046982184c645f72edcdd1b82843347f605d7bf7b15716',
    },
    {
        id: 'am_michael',
        name: 'Michael',
        gender: 'male',
        accent: 'american',
        sha256: '1d1f21dd8da39c30705cd4c75d039d265e9bc4a2a93ed09bc9e1b1225eb95ba1',
    },
    {
        id: 'bf_emma',
        name: 'Emma',
        gender: 'female',
        accent: 'british',
        sha256: '669fe0647f9dd04fcab92f1439a40eeb4c8b4ab1f82e4996fe3d918ce4a63b73',
    },
    {
        id: 'bf_isabella',
        name: 'Isabella',
        gender: 'female',
        accent: 'british',
        sha256: '3754352c4aaa46d17f27654ab7518d65b62ad6163a0f55a5f4330c2da2c4e94f',
    },
    {
        id: 'bm_george',
        name: 'George',
        gender: 'male',
        accent: 'british',
        sha256: 'c4b235a4c1f2cd3b939fed08b899ce9385638b763f7b73a59616c4fc9bd6c9bc',
    },
    {
        id: 'bm_lewis',
        name: 'Lewis',
        gender: 'male',
        accent: 'british',
        sha256: 'b8f671cef828c30e66fdf0b0756a76bba58f6bb3398cbbf27058642acbcedb97',
    },
    {
        id: 'af_alloy',
        name: 'Alloy',
        gender: 'female',
        accent: 'american',
        sha256: 'c4a6b876047fd7fb472edf4ebd63cfac7c3b958a7cae7c106e8f038ca6308c45',
    },
    {
        id: 'af_nova',
        name: 'Nova',
        gender: 'female',
        accent: 'american',
        sha256: '18778272caa0d0eebaea251c35fd635f038434f9eee5e691d02a174bd328414f',
    },
    {
        id: 'af_aoede',
        name: 'Aoede',
        gender: 'female',
        accent: 'american',
        sha256: '4a004c33430762e2461eedb2013fad808ef4ab3121f5300f554476caf58d8361',
    },
    {
        id: 'am_echo',
        name: 'Echo',
        gender: 'male',
        accent: 'american',
        sha256: '3968b92c3c4cd1c4416dbded36c13eaa388a90d5788d02a13e4d781f5f8cf3c3',
    },
    {
        id: 'am_eric',
        name: 'Eric',
        gender: 'male',
        accent: 'american',
        sha256: 'e8b5be17edd1e3636901ce7598baafe2dc8dd8ff707a0c23bf9e461add7e2832',
    },
    {
        id: 'am_onyx',
        name: 'Onyx',
        gender: 'male',
        accent: 'american',
        sha256: 'da5d135b424164916d75a68ffb4c2abce3d7d5ccc82dd1ee6cf447ce286145e6',
    },
    {
        id: 'am_liam',
        name: 'Liam',
        gender: 'male',
        accent: 'american',
        sha256: '52403be32fd047c6a44517cb0bcd6b134f2a18baa73e70ef41651e0eab921ade',
    },
    {
        id: 'af_jessica',
        name: 'Jessica',
        gender: 'female',
        accent: 'american',
        sha256: 'a240a5e3c15b43563d6e923bdca8ef5613a23471d9b77653694012435df23bd8',
    },
    {
        id: 'af_river',
        name: 'River',
        gender: 'female',
        accent: 'american',
        sha256: '00a2bcf82b1d86e8f19902ede58c65ccf6c0e43b44b7d74fad54e5d8933c9c30',
    },
    {
        id: 'am_santa',
        name: 'Santa',
        gender: 'male',
        accent: 'american',
        sha256: '61150cf726ab6c5ed7a99f90a304f91f5a72c00c592e89ec94e5df11c319227a',
    },
] as const satisfies readonly {
    id: string;
    name: string;
    gender: 'male' | 'female';
    accent: 'american' | 'british';
    sha256: string;
}[];

export const KOKORO_VOICE_SIZE_BYTES = 522_240;
export const KOKORO_VOICE_BASE_URL = `${KOKORO_BASE_URL}/voices`;
