import { MODEL_RELEASE_ADMISSION } from '#/infra/release/modelReleaseAdmission';

import { ensureWhisperReady as ensureWhisperReadyInAdapter } from '../../repositories/voiceNativeAdapter/ensureWhisperReady';

export function ensureWhisperReady(): Promise<void> {
    if (!MODEL_RELEASE_ADMISSION.whisper) {
        return Promise.reject(new Error('Whisper model artifacts are not admitted in this release'));
    }
    return ensureWhisperReadyInAdapter();
}
