import { describe, expect, it } from 'vitest';

import { EXPOSED_COMMANDS } from '../commands.js';
import {
    createPluginCommandAdmission,
    isPluginRuntimeCommand,
    PLUGIN_RUNTIME_COMMANDS,
} from '../pluginCommandAdmission.js';

describe('plugin runtime command classification', () => {
    it('classifies every exposed command against PLUGIN_RUNTIME_COMMANDS', () => {
        const runtimeCommands = new Set<string>(PLUGIN_RUNTIME_COMMANDS);

        for (const command of EXPOSED_COMMANDS) {
            expect(isPluginRuntimeCommand(command)).toBe(runtimeCommands.has(command));
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
    });

    it('refuses runtime commands once quit has begun', () => {
        const admission = createPluginCommandAdmission();

        admission.refusePluginCommands();

        expect(admission.acceptsCommand('load_plugin')).toBe(false);
        expect(admission.acceptsCommand('unload_plugin')).toBe(false);
        expect(admission.acceptsCommand('scan_plugins')).toBe(false);
    });

    it('still accepts non-runtime commands after quit has begun', () => {
        const admission = createPluginCommandAdmission();

        admission.refusePluginCommands();

        expect(admission.acceptsCommand('list_midi_inputs')).toBe(true);
    });
});
