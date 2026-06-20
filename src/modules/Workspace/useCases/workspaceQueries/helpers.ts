import { type EditingTool } from '../../models/EditingTool';
import {
    defaultPreferences,
    type Preferences,
    type GridSnapOption,
    type BufferSizeOption,
    type SampleRateOption,
    type SoloModePreference,
} from '../../models/Preferences';
import {
    type WorkspaceState,
    type WorkspaceMode,
    type SoloMode,
    type ChannelStripWidth,
    type TimeDisplayMode,
    type AutomationVisibility,
    type MarqueeSelection,
} from '../../models/WorkspaceState';

export type {
    WorkspaceState,
    WorkspaceMode,
    SoloMode,
    ChannelStripWidth,
    TimeDisplayMode,
    AutomationVisibility,
    MarqueeSelection,
    EditingTool,
    Preferences,
    GridSnapOption,
    BufferSizeOption,
    SampleRateOption,
    SoloModePreference,
};

// Re-export the canonical default from the model. The single source of truth lives in
// models/Preferences.ts — preferencesStore and useCases consume it through this barrel.
export { defaultPreferences };

export const TRACK_HEIGHT_VALUES: Record<Preferences['trackHeight'], number> = {
    compact: 40,
    normal: 64,
    large: 96,
};

export const TOOL_SHORTCUTS: Record<string, EditingTool> = {
    s: 'select',
    c: 'cut',
    d: 'draw',
    b: 'draw',
    t: 'stretch',
};
