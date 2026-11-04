export type EditingTool = 'select' | 'cut' | 'draw' | 'automation' | 'stretch' | 'marquee';

export const TOOL_SHORTCUTS: Record<string, EditingTool> = {
    s: 'select',
    c: 'cut',
    d: 'draw',
    b: 'draw',
    t: 'stretch',
    e: 'marquee',
};

/** Number-row tool selectors. `handleKeydown` reads this map, so help text derived from it cannot drift. */
export const NUMBER_TOOL_SHORTCUTS: Record<string, EditingTool> = {
    '1': 'select',
    '2': 'cut',
    '3': 'draw',
    '4': 'automation',
    '5': 'stretch',
};

const keysSelecting = (shortcuts: Record<string, EditingTool>, tool: EditingTool): string[] =>
    Object.entries(shortcuts)
        .filter(([, mapped]) => mapped === tool)
        .map(([key]) => key.toUpperCase());

/** Display keys of the letter shortcuts that select `tool`, in `TOOL_SHORTCUTS` order (`['D', 'B']`). */
const getToolLetterKeys = (tool: EditingTool): string[] => keysSelecting(TOOL_SHORTCUTS, tool);

/** Display keys of every shortcut that selects `tool`: letters first, then the number (`['D', 'B', '3']`). */
export const getToolShortcutKeys = (tool: EditingTool): string[] => [
    ...getToolLetterKeys(tool),
    ...keysSelecting(NUMBER_TOOL_SHORTCUTS, tool),
];

export const EDITING_TOOLS = ['select', 'cut', 'draw', 'automation', 'stretch', 'marquee'] as const;

/**
 * Narrows an untrusted tool name. The `setEditingTool` app action carries
 * `{ tool: string }` and is marked `'unchecked'` by the AI payload validator, so an
 * AI- or palette-originated value reaches the handler unvalidated; casting it would
 * put a bogus tool straight into workspace state.
 */
export const isEditingTool = (value: unknown): value is EditingTool => {
    return typeof value === 'string' && (EDITING_TOOLS as readonly string[]).includes(value);
};

const labelWithLetters = (name: string, tool: EditingTool): string => {
    const letters = getToolLetterKeys(tool);
    return letters.length === 0 ? name : `${name} (${letters.join('/')})`;
};

export const TOOL_LABELS: Record<EditingTool, string> = {
    select: labelWithLetters('Select', 'select'),
    cut: labelWithLetters('Cut', 'cut'),
    draw: labelWithLetters('Draw', 'draw'),
    automation: labelWithLetters('Auto-draw', 'automation'),
    stretch: labelWithLetters('Stretch', 'stretch'),
    marquee: labelWithLetters('Marquee', 'marquee'),
};
