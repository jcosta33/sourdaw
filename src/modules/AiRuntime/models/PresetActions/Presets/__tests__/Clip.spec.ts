import { describe, expect, it } from 'vitest';

import { clipPresets } from '../Clip';
import { type PresetContext } from '../Types';

const context: PresetContext = {
    selectedTrackId: 'track-1',
    selectedClipId: 'clip-1',
    selectedClipType: 'audio',
    trackCount: 1,
};

function stretchModeFor(presetId: string): string {
    const preset = clipPresets.find((candidate) => candidate.id === presetId);
    if (!preset) {
        throw new Error(`Missing preset ${presetId}`);
    }
    const action = preset.buildAction(context);
    if (!action || Array.isArray(action) || action.type !== 'setClipStretchMode') {
        throw new Error(`Expected a setClipStretchMode action for ${presetId}`);
    }
    return action.payload.mode;
}

describe('clip stretch presets', () => {
    it('routes each stretch preset to its own mode on the same action', () => {
        expect(stretchModeFor('repitch-mode')).toBe('repitch');
        expect(stretchModeFor('timestretch-mode')).toBe('timestretch');
        expect(stretchModeFor('stretch-off')).toBe('off');
    });

    it('does not advertise timestretch as pitch-preserving while it resamples', () => {
        const preset = clipPresets.find((candidate) => candidate.id === 'timestretch-mode');

        expect(preset?.label).toMatch(/no pitch preservation/i);
    });
});
