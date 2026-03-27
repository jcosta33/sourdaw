/**
 * Preset Action Registry — barrel re-export
 *
 * Category implementations live in ./presets/*.ts.
 * This file assembles them into the PRESET_ACTIONS array and
 * re-exports the public API for backward compatibility.
 */

import {
    transportPresets,
    trackPresets,
    devicePresets,
    clipPresets,
    midiPresets,
    generatePresets,
    workspacePresets,
    mixPresets,
    automationPresets,
    filePresets,
    collaborationPresets,
} from './presets';

export type { PresetContext, PresetAction, PresetCategory } from './presets';

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
