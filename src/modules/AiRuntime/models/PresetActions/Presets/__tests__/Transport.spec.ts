import { describe, expect, it } from 'vitest';

import { transportPresets } from '../Transport';

const context = {
    selectedTrackId: undefined,
    selectedClipId: undefined,
    selectedClipType: undefined,
    trackCount: 0,
} as const;

describe('transportPresets', () => {
    it('maps play and resume to explicit playback start', () => {
        const play = transportPresets.find((preset) => preset.id === 'play');

        expect(play?.keywords).toContain('resume');
        expect(play?.buildAction(context)).toEqual({ type: 'setPlayback', payload: { playing: true } });
    });

    it('maps pause to explicit playback pause', () => {
        const pause = transportPresets.find((preset) => preset.id === 'pause');

        expect(pause?.buildAction(context)).toEqual({ type: 'setPlayback', payload: { playing: false } });
    });

    it('maps Stop to the stopPlayback command so recording teardown is preserved', () => {
        const stop = transportPresets.find((preset) => preset.id === 'stop');

        expect(stop?.buildAction(context)).toEqual({ type: 'stopPlayback' });
    });

    it('does not expose state-dependent playback or recording toggles', () => {
        const actions = transportPresets.flatMap((preset) => {
            const action = preset.buildAction(context);
            if (!action) {
                return [];
            }
            return Array.isArray(action) ? action : [action];
        });

        expect(actions.some((action) => action.type === 'togglePlayback')).toBe(false);
        expect(actions.some((action) => action.type === 'toggleRecording')).toBe(false);
    });
});
