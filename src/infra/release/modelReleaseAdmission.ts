const E2E_WEBLLM_ADMISSION_FLAG = '__SOURDAW_E2E_WEBLLM_ADMITTED__';

function getBuildMode(): string | undefined {
    const env = Reflect.get(import.meta, 'env');
    if (typeof env !== 'object' || env === null) {
        return undefined;
    }

    const mode = Reflect.get(env, 'MODE');
    return typeof mode === 'string' ? mode : undefined;
}

function isE2eWebLlmAdmitted(): boolean {
    return getBuildMode() === 'e2e' && Reflect.get(globalThis, E2E_WEBLLM_ADMISSION_FLAG) === true;
}

export const MODEL_RELEASE_ADMISSION = Object.freeze({
    basicPitch: true,
    ddsp: true,
    kokoro: true,
    rave: false,
    stemSeparation: false,
    // The E2E harness can exercise admitted UI and action paths without
    // shipping a WebLLM artifact. Production and every non-E2E build retain
    // the release decision above: WebLLM is withheld.
    webLlm: isE2eWebLlmAdmitted(),
    whisper: true,
});
