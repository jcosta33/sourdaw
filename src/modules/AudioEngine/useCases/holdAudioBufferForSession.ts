import { audioBufferCache } from '../stores/audioBufferCache';

type HoldAudioBufferForSessionInput = {
    buffer: AudioBuffer;
    bufferId: string;
};

/**
 * Hold a buffer for this session without storing it. Nothing is written and
 * no PCM is kept to write later, so it can never overwrite audio storage holds
 * for the id, even a record a failed read could not see. Once evicted, the
 * buffer is gone until its caller supplies it again.
 */
export function holdAudioBufferForSession({ buffer, bufferId }: HoldAudioBufferForSessionInput): void {
    audioBufferCache.holdForSession(bufferId, buffer);
}
