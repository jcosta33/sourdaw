import { isAudioGenerationAvailable } from '#/modules/AudioAnalysis/useCases';

import { createAiGenerationError } from '../../errors/AiGenerationError';

export const AUDIO_GENERATION_UNAVAILABLE_MESSAGE =
    'Audio generation requires the Sourdaw desktop app (uses Stable Audio Open via Python sidecar)';

export function ensureAudioGenerationAvailable(): void {
    if (!isAudioGenerationAvailable()) {
        throw createAiGenerationError(AUDIO_GENERATION_UNAVAILABLE_MESSAGE);
    }
}
