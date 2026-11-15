export type WebLlmModelAdmission = {
    /** The accepted decision record that admits this model. */
    decisionRecord: string;
    /** The artifact-set digest the decision record admits; it must equal the release manifest's. */
    artifactSetDigest: string;
    /** Identifier of the licence (an SPDX id, or a `LicenseRef-` one where none exists) the decision record names for the model. */
    licence: string;
};

const QWEN_ADMISSION_RECORD = '.agents/decisions/0037-admit-webllm-qwen-conversions-under-apache-2.0.md';

const LLAMA_ADMISSION_RECORD =
    '.agents/decisions/0060-admit-webllm-llama-3-1-70b-under-the-llama-3-1-community-license.md';

/** One entry per catalogue model id. A spec fails a catalogue model with no entry here. */
export const WEBLLM_MODEL_ADMISSIONS: Readonly<Record<string, WebLlmModelAdmission>> = {
    'Qwen3-1.7B-q4f16_1-MLC': {
        decisionRecord: QWEN_ADMISSION_RECORD,
        artifactSetDigest: 'a8c02294f8d3c23e7ff2a9174d3a575e7809c7463870b6e23d2d6e6f1dac7991',
        licence: 'Apache-2.0',
    },
    'Qwen3-4B-q4f16_1-MLC': {
        decisionRecord: QWEN_ADMISSION_RECORD,
        artifactSetDigest: '2e136079f88bb3aea4289642db64fef8d77a0cb4c503ca6ca90a4030e0b75756',
        licence: 'Apache-2.0',
    },
    'Qwen3-8B-q4f16_1-MLC': {
        decisionRecord: QWEN_ADMISSION_RECORD,
        artifactSetDigest: '5121d9a5818d4693e0b0f2dc55f2982ece120b875c955203e4650a9269ad6d2a',
        licence: 'Apache-2.0',
    },
    'Llama-3.1-70B-Instruct-q3f16_1-MLC': {
        decisionRecord: LLAMA_ADMISSION_RECORD,
        artifactSetDigest: 'c5b181b8df7e33660d14aba38131081bab344cfd09f6f6616df93b69b0023ff0',
        licence: 'LicenseRef-Llama-3.1-Community-License',
    },
};
