function isE2eWebLlmAdmitted(): boolean {
    return (
        import.meta.env.MODE === 'e2e' &&
        typeof window !== 'undefined' &&
        Reflect.get(window, '__SOURDAW_E2E_WEBLLM_ADMITTED__') === true
    );
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
