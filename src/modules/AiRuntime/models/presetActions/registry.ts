/**
 * Preset Action Registry.
 *
 * Category implementations live in ./presets/*.ts. This file assembles
 * them into the PRESET_ACTIONS array and exposes the shared PresetContext /
 * PresetAction / PresetCategory types from ./presets/types.
 */

import { transportPresets } from './presets/transport';
import { trackPresets } from './presets/track';
import { devicePresets } from './presets/device';
import { clipPresets } from './presets/clip';
import { midiPresets } from './presets/midi';
import { generatePresets } from './presets/generate';
import { workspacePresets } from './presets/workspace';
import { mixPresets, automationPresets } from './presets/mixAndAutomation';
import { filePresets, collaborationPresets } from './presets/fileAndCollaboration';

export type { PresetContext, PresetAction, PresetCategory } from './presets/types';

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
