import { mappingAmountDragState } from './mappingAmountDragState';

/** Whether a modulation-amount drag gesture is currently in progress. */
export function isMappingAmountDragActive(): boolean {
    return mappingAmountDragState.activeSession !== null;
}
