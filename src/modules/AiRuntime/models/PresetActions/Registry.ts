/**
 * Preset Action Registry.
 *
 * Category implementations live in ./Presets/*.ts. This file assembles
 * them into the PRESET_ACTIONS array and exposes the shared PresetContext /
 * PresetAction / PresetCategory types from ./Presets/Types.
 */

import { clipPresets } from './Presets/Clip';
import { devicePresets } from './Presets/Device';
import { filePresets, collaborationPresets } from './Presets/FileAndCollaboration';
import { generatePresets } from './Presets/Generate';
import { midiPresets } from './Presets/Midi';
import { mixPresets, automationPresets } from './Presets/MixAndAutomation';
import { trackPresets } from './Presets/Track';
import { transportPresets } from './Presets/Transport';
import { workspacePresets } from './Presets/Workspace';

export type { PresetContext, PresetAction, PresetCategory } from './Presets/Types';

// ── The Registry ────────────────────────────────────────────────────────

export const PRESET_ACTIONS = [
    ...transportPresets,
    ...trackPresets,
    ...devicePresets,
    ...clipPresets,
    ...midiPresets,
    ...generatePresets,
    ...workspacePresets,
    ...mixPresets,
    ...automationPresets,
    ...filePresets,
    ...collaborationPresets,
] as const;

// ── Category display order ──────────────────────────────────────────────

export const CATEGORY_ORDER = [
    'Transport',
    'Track',
    'Clip',
    'MIDI',
    'Device',
    'Generate',
    'Workspace',
    'Mix',
    'Automation',
    'File',
    'Collaboration',
] as const;
