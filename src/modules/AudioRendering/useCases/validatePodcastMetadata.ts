import { writePodcastId3 } from '../repositories/audioEncoders/writePodcastId3';

/** Refuse invalid episode text before reserving a destination or rendering audio. */
export function validatePodcastMetadata(metadata: Parameters<typeof writePodcastId3>[0]['metadata']): void {
    writePodcastId3({ metadata, encodedBytes: new Uint8Array() });
}
