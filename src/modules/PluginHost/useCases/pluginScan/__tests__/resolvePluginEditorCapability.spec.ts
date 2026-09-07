import { describe, expect, it } from 'vitest';

import { resolvePluginEditorCapability } from '../resolvePluginEditorCapability';

describe('resolvePluginEditorCapability', () => {
    it('reports an editor the scan read from the plugin', () => {
        expect(resolvePluginEditorCapability({ has_custom_ui: true })).toBe('available');
    });

    it('reports no editor when the scan asked and the plugin said no', () => {
        expect(resolvePluginEditorCapability({ has_custom_ui: false })).toBe('absent');
    });

    /**
     * The scanner publishes an unqueried capability as `false` beside the reason
     * it could not ask. Reading that as "no editor" hides the editor of every
     * plugin the scanner could not inspect, which is the whole class of plugins
     * most likely to need one opened by hand.
     */
    it('reports unknown when a reason says the capability may not have been queried', () => {
        expect(
            resolvePluginEditorCapability({
                has_custom_ui: false,
                capability_metadata_reason: 'the scanner did not inspect this plugin',
            })
        ).toBe('unknown');
    });

    /**
     * The scanner answers the port question and leaves the editor question open
     * for a format whose only editor query is an editor call it cannot make.
     * Reading that `false` as "no editor" hides the control for every plugin in
     * that format, whose editors the runtime host can in fact open.
     */
    it('reports unknown when the reason says the editor question was never asked', () => {
        expect(
            resolvePluginEditorCapability({
                has_custom_ui: false,
                capability_metadata_reason:
                    'The scanner did not ask this plugin whether it offers an editor; the host asks the plugin itself when it loads.',
            })
        ).toBe('unknown');
    });

    it('reports unknown for a plugin the scan registry does not hold', () => {
        expect(resolvePluginEditorCapability(undefined)).toBe('unknown');
    });

    /** A registry entry written before the scan published this field at all. */
    it('reports unknown when the entry carries no capability field', () => {
        expect(resolvePluginEditorCapability({})).toBe('unknown');
    });
});
