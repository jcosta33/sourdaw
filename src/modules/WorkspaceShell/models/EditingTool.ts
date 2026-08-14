export type EditingTool = 'select' | 'cut' | 'draw' | 'automation' | 'stretch' | 'marquee';

export const TOOL_SHORTCUTS: Record<string, EditingTool> = {
    s: 'select',
    c: 'cut',
    d: 'draw',
    b: 'draw',
    t: 'stretch',
    e: 'marquee',
};

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

export const TOOL_LABELS: Record<EditingTool, string> = {
    select: 'Select (S)',
    cut: 'Cut (C)',
    draw: 'Draw (D/B)',
    automation: 'Auto-draw',
    stretch: 'Stretch (T)',
    marquee: 'Marquee (E)',
};
