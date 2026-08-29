import { describe, expect, it } from 'vitest';

import {
    createPluginCommandAdmission,
    isPluginRuntimeCommand,
    PLUGIN_RUNTIME_COMMANDS,
} from '../pluginCommandAdmission.js';

/** Explicit pin of the production runtime surface — omitting a member must fail. */
const EXPECTED_PLUGIN_RUNTIME_COMMANDS = [
    'close_plugin_gui',
    'get_plugin_parameters',
    'get_plugin_state_bytes',
    'load_plugin',
    'open_plugin_gui',
    'process_plugin_audio',
    'scan_plugins',
    'set_plugin_bypass',
    'set_plugin_parameter',
    'set_plugin_state_bytes',
    'unload_plugin',
] as const;

describe('plugin runtime command classification', () => {
    it('pins PLUGIN_RUNTIME_COMMANDS to the known runtime surface', () => {
        expect([...PLUGIN_RUNTIME_COMMANDS]).toEqual([...EXPECTED_PLUGIN_RUNTIME_COMMANDS]);
    });

    it('classifies each expected runtime command', () => {
        for (const command of EXPECTED_PLUGIN_RUNTIME_COMMANDS) {
            expect(isPluginRuntimeCommand(command)).toBe(true);
        }
    });

    it('keeps the runtime list sorted for one-line diffs', () => {
        expect([...PLUGIN_RUNTIME_COMMANDS].toSorted()).toEqual([...PLUGIN_RUNTIME_COMMANDS]);
    });
});

describe('plugin command admission during quit', () => {
    it('accepts runtime commands until quit begins', () => {
        const admission = createPluginCommandAdmission();

        expect(admission.acceptsCommand('load_plugin')).toBe(true);
        expect(admission.acceptsCommand('close_plugin_gui')).toBe(true);
    });

    it('refuses runtime commands once quit has begun', () => {
        const admission = createPluginCommandAdmission();

        admission.refusePluginCommands();

        expect(admission.acceptsCommand('load_plugin')).toBe(false);
        expect(admission.acceptsCommand('unload_plugin')).toBe(false);
        expect(admission.acceptsCommand('scan_plugins')).toBe(false);
        expect(admission.acceptsCommand('close_plugin_gui')).toBe(false);
    });

    it('still accepts non-runtime commands after quit has begun', () => {
        const admission = createPluginCommandAdmission();

        admission.refusePluginCommands();

        expect(admission.acceptsCommand('list_midi_inputs')).toBe(true);
    });
});
