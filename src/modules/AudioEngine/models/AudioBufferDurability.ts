import {
    readPersistentPcmRevision,
    readPreparedOwner,
    requiresPromotionReconciliation,
    type PreparedAudioBufferMetadata,
} from './AudioBufferPersistenceIdentity';
import { isValidPreparedSerializedAudioBuffer } from './SerializedAudioBuffer';

export const AUDIO_BUFFER_DATABASE_NAME = 'sourdaw-audio';
export const AUDIO_BUFFER_DATABASE_VERSION = 5;
export const AUDIO_BUFFER_PCM_STORE = 'buffers';

/** Age and size collectors use metadata so an access refresh never reads or
 * rewrites the PCM. The original timestamps and sizes remain in the PCM
 * records so legacy records can seed metadata during a lazy backfill.
 * Durability still reads and validates both rows in one transaction. */
export const AUDIO_BUFFER_METADATA_STORE = 'bufferMeta';

export type AudioBufferDurabilityRequest = {
    readonly ids: readonly string[];
};

export type AudioBufferDurabilityResponse =
    { status: 'complete'; revisions: (string | null)[] } | { status: 'failed' } | { status: 'unavailable' };

export function isValidAudioBufferMetadata(
    metadata: unknown,
    sizeInBytes: number
): metadata is PreparedAudioBufferMetadata {
    if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
        return false;
    }
    const candidate = metadata as Record<string, unknown>;
    return (
        typeof candidate.lastAccessed === 'number' &&
        Number.isFinite(candidate.lastAccessed) &&
        candidate.sizeInBytes === sizeInBytes &&
        (candidate.freezeProjectId === undefined ||
            (typeof candidate.freezeProjectId === 'number' &&
                Number.isSafeInteger(candidate.freezeProjectId) &&
                candidate.freezeProjectId >= 0))
    );
}

/** Validate the PCM and its matching metadata from one readonly transaction. */
export function readDurableAudioBufferRevision(data: unknown, metadata: unknown): string | null {
    if (!isValidPreparedSerializedAudioBuffer(data) || !isValidAudioBufferMetadata(metadata, data.sizeInBytes)) {
        return null;
    }
    const owner = readPreparedOwner(metadata);
    if (!(
        owner === null ||
        (owner !== 'invalid' && owner.status === 'project-owned' && !requiresPromotionReconciliation(owner))
    )) {
        return null;
    }
    return readPersistentPcmRevision(metadata);
}
