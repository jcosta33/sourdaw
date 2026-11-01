import { readUndoHistoryAudioBufferIds } from './readUndoHistoryAudioBufferIds';

/**
 * Whether any entry in the undo/redo history could still restore a clip that
 * references `bufferId` (see `readUndoHistoryAudioBufferIds` for what is read).
 * A match means undo or redo would resurrect a clip referencing the buffer, so
 * callers must treat the buffer as owned until the entry leaves the history.
 */
export function isAudioBufferReferencedByUndoHistory(bufferId: string): boolean {
    return readUndoHistoryAudioBufferIds().has(bufferId);
}
