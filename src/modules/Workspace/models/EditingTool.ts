export type EditingTool = 'select' | 'cut' | 'draw' | 'automation' | 'stretch';

export const TOOL_SHORTCUTS: Record<string, EditingTool> = {
    s: 'select',
    c: 'cut',
    d: 'draw',
    a: 'automation',
    t: 'stretch',
};

export const TOOL_LABELS: Record<EditingTool, string> = {
    select: 'Select (S)',
    cut: 'Cut (C)',
    draw: 'Draw (D)',
    automation: 'Auto-draw (A)',
    stretch: 'Stretch (T)',
};
