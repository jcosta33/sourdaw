import { audioBufferCache } from '../stores/audioBufferCache';

export type CachedAudioBuffersDurabilityReceipt = {
    status: 'durable';
    isCurrent: () => boolean;
    release: () => void;
};

export type CachedAudioBuffersDurabilityResult =
    | CachedAudioBuffersDurabilityReceipt
    | {
          status: 'failed';
          failedIds: readonly string[];
      }
    | {
          status: 'superseded';
      };

/** Hold the exact required PCM sources durable while one project snapshot commits. */
export function ensureCachedAudioBuffersDurable(
    requiredAudioBufferIds: readonly string[]
): Promise<CachedAudioBuffersDurabilityResult> {
    return audioBufferCache.ensureDurable(requiredAudioBufferIds);
}
