import { mappingAmountDragKey, mappingAmountDragState } from './mappingAmountDragState';
import { type MappingTarget } from './removeMapping';

/** Whether a drag gesture is currently in progress for this one mapping. */
export function isMappingAmountDragActive(modulatorId: string, target: MappingTarget): boolean {
    return mappingAmountDragState.activeSessions.has(mappingAmountDragKey(modulatorId, target));
}
