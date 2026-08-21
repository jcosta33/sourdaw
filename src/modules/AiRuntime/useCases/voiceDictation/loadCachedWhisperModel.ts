import { MODEL_RELEASE_ADMISSION } from '#/infra/release/modelReleaseAdmission';

import { loadCachedWhisperModel as loadCachedNativeWhisperModel } from '../../repositories/voiceNativeAdapter/loadCachedWhisperModel';

export function loadCachedWhisperModel(): Promise<void> {
    if (!MODEL_RELEASE_ADMISSION.whisper) {
        return Promise.reject(new Error('Local Whisper is withheld by this release.'));
    }
    return loadCachedNativeWhisperModel();
}
