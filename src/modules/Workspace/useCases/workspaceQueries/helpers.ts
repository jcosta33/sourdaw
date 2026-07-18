import { type EditingTool } from '../../models/EditingTool';
import {
    type WorkspaceState,
    type WorkspaceMode,
    type SoloMode,
    type ChannelStripWidth,
    type TimeDisplayMode,
    type AutomationVisibility,
} from '../../models/WorkspaceState';

export type {
    WorkspaceState,
    WorkspaceMode,
    SoloMode,
    ChannelStripWidth,
    TimeDisplayMode,
    AutomationVisibility,
    EditingTool,
};

export const TOOL_SHORTCUTS: Record<string, EditingTool> = {
    s: 'select',
    c: 'cut',
    d: 'draw',
    b: 'draw',
    t: 'stretch',
};
