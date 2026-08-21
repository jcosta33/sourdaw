import { voiceInputAvailabilityStore } from '../../stores/voiceInputAvailabilityStore';
import { loadCachedWhisperModel } from '../voiceDictation/loadCachedWhisperModel';

/** Owns the shared local-voice availability transition during application startup. */
export async function initializeVoiceInputAvailability(): Promise<void> {
    try {
        await loadCachedWhisperModel();
        voiceInputAvailabilityStore.set({ hasVerifiedLocalModel: true });
    } catch {
        voiceInputAvailabilityStore.set({ hasVerifiedLocalModel: false });
    }
}
