import { type EditingTool, getToolShortcutKeys } from '../models/EditingTool';

/** The keys that select `tool`, ready to show beside it (`D / B / 3`). */
export function getToolShortcutHint(tool: EditingTool): string {
    return getToolShortcutKeys(tool).join(' / ');
}
