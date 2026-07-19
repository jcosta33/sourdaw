import { describe, expect, it } from 'vitest';

import { defaultGrooveTemplateState } from '#/modules/MIDI/stores';

import { midiPresets } from '../Midi';

describe('MIDI groove presets', () => {
    it('targets only identities present in the canonical MIDI groove catalog', () => {
        const catalogIds = new Set(defaultGrooveTemplateState.templates.map((template) => template.id));
        const groovePresets = midiPresets.filter((preset) => preset.id.startsWith('groove-'));
        const context = {
            selectedTrackId: 'track-1',
            selectedClipId: 'clip-1',
            selectedClipType: 'midi' as const,
            trackCount: 1,
        };

        for (const preset of groovePresets) {
            const action = preset.buildAction(context);
            if (!action || Array.isArray(action) || action.type !== 'applyGroove') {
                throw new Error(`Expected applyGroove action for ${preset.id}`);
            }
            expect(catalogIds.has(action.payload.grooveId)).toBe(true);
        }
    });
});
