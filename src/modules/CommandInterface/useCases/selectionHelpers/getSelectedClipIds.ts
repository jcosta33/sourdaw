import { clipSelectionStore } from '#/modules/Arrangement/stores';

import { type CommandContext } from '../../models/CommandContext';
export function getSelectedClipIds(context?: CommandContext): string[] {
    if (context) {
        return [...context.selectedClipIds];
    }
    const ws = clipSelectionStore.value;
    if (!ws) {
        return [];
    }
    if (ws.selectedClipIds.length > 0) {
        return ws.selectedClipIds;
    }
    if (ws.selectedClipId) {
        return [ws.selectedClipId];
    }
    return [];
}
