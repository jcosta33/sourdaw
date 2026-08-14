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

// Re-exported, never redeclared. A second literal here silently diverged from
// `models/EditingTool` and dropped `e: 'marquee'`, so the keyboard path (which
// reads this copy through `useCases/index.ts`) could not reach a tool whose own
// label advertises the shortcut.
export { TOOL_SHORTCUTS } from '../../models/EditingTool';
