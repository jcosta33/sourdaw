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

    it.each([
        ['loop', 'setLoopEnabled', 'loopEnabled'],
        ['metronome', 'setMetronomeEnabled', 'metronomeEnabled'],
    ] as const)('%s emits the negation of the current state through %s', (id, type, stateKey) => {
        const preset = transportPresets.find((candidate) => candidate.id === id);

        expect(preset?.buildAction({ ...context, [stateKey]: false })).toEqual({ type, payload: { enabled: true } });
        expect(preset?.buildAction({ ...context, [stateKey]: true })).toEqual({ type, payload: { enabled: false } });
    });

    it.each(['loop', 'metronome'])('%s emits nothing when the current state is unknown', (id) => {
        const preset = transportPresets.find((candidate) => candidate.id === id);

        expect(preset?.buildAction(context)).toBeNull();
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
        expect(actions.map((action) => action.type)).not.toContain('togglePunch');
    });

    it('offers explicit punch in/out picker entries without a state-dependent toggle', () => {
        const enable = transportPresets.find((preset) => preset.id === 'punch-in-out-on');
        const disable = transportPresets.find((preset) => preset.id === 'punch-in-out-off');
        const keywords = transportPresets.flatMap((preset) => preset.keywords);

        expect(enable?.buildAction(context)).toEqual({ type: 'setPunchEnabled', payload: { enabled: true } });
        expect(disable?.buildAction(context)).toEqual({ type: 'setPunchEnabled', payload: { enabled: false } });
        expect(keywords).not.toContain('punch');
        expect(keywords).not.toContain('punch in');
        expect(keywords).not.toContain('punch out');
        expect(keywords).not.toContain('toggle punch');
    });
});
