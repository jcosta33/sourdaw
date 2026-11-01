import { type EditingTool, NUMBER_TOOL_SHORTCUTS, TOOL_SHORTCUTS } from '../models/EditingTool';

type ToolKeyPress = {
    key: string;
    /** Cmd or Ctrl held. */
    mod: boolean;
    alt: boolean;
};

/**
 * The tool a key press selects, or null. A press with Cmd, Ctrl or Alt held belongs to
 * the shortcut store (Cmd+C is copy, not the cut tool) and never selects a tool.
 */
export function getToolForKeyPress({ key, mod, alt }: ToolKeyPress): EditingTool | null {
    if (mod || alt) {
        return null;
    }
    return NUMBER_TOOL_SHORTCUTS[key] ?? TOOL_SHORTCUTS[key] ?? null;
}
