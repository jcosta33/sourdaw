import { isDesktopRuntime } from '#/utils/desktopRuntime';

import { voiceInputAvailabilityStore } from '../../stores/voiceInputAvailabilityStore';
import { voiceModelSetupStore } from '../../stores/voiceModelSetupStore';
import { loadCachedWhisperModel } from '../voiceDictation/loadCachedWhisperModel';

/** Owns the shared local-voice availability transition during application startup. */
export async function initializeVoiceInputAvailability(): Promise<void> {
    try {
        await loadCachedWhisperModel();
        voiceInputAvailabilityStore.set({ hasVerifiedLocalModel: true });
    } catch {
        voiceInputAvailabilityStore.set({ hasVerifiedLocalModel: false });
        // A failed cache load on the desktop runtime — miss or corruption
        // alike, since a re-download overwrites either — is retryable through
        // the consented download flow, so the setup affordance surfaces. Off
        // the desktop there is no such flow and the voice button stays hidden.
        if (isDesktopRuntime()) {
            voiceModelSetupStore.set({ state: 'missing' });
        }
    }
}
