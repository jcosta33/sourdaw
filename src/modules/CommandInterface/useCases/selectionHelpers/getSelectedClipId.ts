import { clipSelectionStore } from '#/modules/Arrangement/stores';

import { type CommandContext } from '../../models/CommandContext';

export function getSelectedClipId(context?: CommandContext): string | null {
    if (context) {
        return context.selectedClipId;
    }
    const ws = clipSelectionStore.value;
    if (!ws) {
        return null;
    }
    if (ws.selectedClipIds.length > 0) {
        return ws.selectedClipIds[0] ?? null;
    }
    return ws.selectedClipId;
}
