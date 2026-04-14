export type EditingTool = 'select' | 'cut' | 'draw' | 'automation' | 'stretch' | 'marquee';

export const TOOL_SHORTCUTS: Record<string, EditingTool> = {
    s: 'select',
    c: 'cut',
    d: 'draw',
    b: 'draw',
    t: 'stretch',
    e: 'marquee',
};

export const TOOL_LABELS: Record<EditingTool, string> = {
    select: 'Select (S)',
    cut: 'Cut (C)',
    draw: 'Draw (D/B)',
    automation: 'Auto-draw',
    stretch: 'Stretch (T)',
    marquee: 'Marquee (E)',
};
