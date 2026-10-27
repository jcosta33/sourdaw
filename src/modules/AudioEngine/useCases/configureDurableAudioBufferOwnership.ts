import {
    setDurableAudioBufferOwnershipProvider,
    type DurableAudioBufferOwnershipProvider,
} from '../stores/durableAudioBufferOwnership';

/**
 * Hand the audio-cache collectors the provider that enumerates the buffer ids
 * saved projects durably own and the open project currently references, or
 * `null` to detach one. A typed snapshot carries a local currentness witness;
 * legacy array providers remain supported without that witness. The
 * composition root is the only place that can make this binding: the seam
 * lives on the AudioEngine side, the enumeration on Project's, and neither
 * module may import the other.
 */
export function configureDurableAudioBufferOwnership(next: DurableAudioBufferOwnershipProvider | null): void {
    setDurableAudioBufferOwnershipProvider(next);
}
