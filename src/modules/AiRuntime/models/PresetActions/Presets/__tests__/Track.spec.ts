import { describe, expect, it } from 'vitest';

import { trackPresets } from '../Track';
import { type PresetContext } from '../Types';

const ctxWithTrack: PresetContext = {
    selectedTrackId: 'track-1',
    selectedTrackKind: 'audio',
    selectedClipId: undefined,
    selectedClipType: undefined,
    trackCount: 1,
};

const ctxNoSelection: PresetContext = {
    selectedTrackId: undefined,
    selectedClipId: undefined,
    selectedClipType: undefined,
    trackCount: 0,
};

describe('trackPresets — creation presets', () => {
    it('builds addTrack with the correct kind for audio, midi, and bus', () => {
        const expected: Record<string, string> = {
            'add-audio-track': 'audio',
            'add-midi-track': 'midi',
            'add-bus-track': 'bus',
        };
        for (const preset of trackPresets.filter((p) => p.id in expected)) {
            const action = preset.buildAction(ctxWithTrack);
            if (action === null || Array.isArray(action)) {
                throw new Error(`Expected action for ${preset.id}`);
            }
            expect(action.type).toBe('addTrack');
            const kind = expected[preset.id];
            if (!kind) {
                throw new Error(`No expected kind for ${preset.id}`);
            }
            expect(action.payload).toMatchObject({ kind });
        }
    });

    it('builds createFolder action for add-folder', () => {
        const preset = trackPresets.find((p) => p.id === 'add-folder')!;
        const action = preset.buildAction(ctxWithTrack);
        if (action === null || Array.isArray(action)) {
            throw new Error('Expected action');
        }
        expect(action.type).toBe('createFolder');
    });
});

describe('trackPresets — trackAction-based presets forward selectedTrackId', () => {
    it('routes mute/unmute to muteTrack with correct muted flag', () => {
        const mute = trackPresets.find((p) => p.id === 'mute-track')!;
        const unmute = trackPresets.find((p) => p.id === 'unmute-track')!;
        const muteAction = mute.buildAction(ctxWithTrack);
        const unmuteAction = unmute.buildAction(ctxWithTrack);
        if (muteAction === null || Array.isArray(muteAction)) {
            throw new Error('Expected mute action');
        }
        if (unmuteAction === null || Array.isArray(unmuteAction)) {
            throw new Error('Expected unmute action');
        }
        expect(muteAction.type).toBe('muteTrack');
        expect(muteAction.payload).toEqual({ trackId: 'track-1', muted: true });
        expect(unmuteAction.payload).toEqual({ trackId: 'track-1', muted: false });
    });

    it('routes solo/unsolo to soloTrack with correct soloed flag', () => {
        const solo = trackPresets.find((p) => p.id === 'solo-track')!;
        const unsolo = trackPresets.find((p) => p.id === 'unsolo-track')!;
        const soloAction = solo.buildAction(ctxWithTrack);
        const unsoloAction = unsolo.buildAction(ctxWithTrack);
        if (soloAction === null || Array.isArray(soloAction)) {
            throw new Error('Expected solo action');
        }
        if (unsoloAction === null || Array.isArray(unsoloAction)) {
            throw new Error('Expected unsolo action');
        }
        expect(soloAction.payload).toEqual({ trackId: 'track-1', soloed: true });
        expect(unsoloAction.payload).toEqual({ trackId: 'track-1', soloed: false });
    });

    it('routes arm/disarm to armTrack with correct armed flag', () => {
        const arm = trackPresets.find((p) => p.id === 'arm-track')!;
        const disarm = trackPresets.find((p) => p.id === 'disarm-track')!;
        const armAction = arm.buildAction(ctxWithTrack);
        const disarmAction = disarm.buildAction(ctxWithTrack);
        if (armAction === null || Array.isArray(armAction)) {
            throw new Error('Expected arm action');
        }
        if (disarmAction === null || Array.isArray(disarmAction)) {
            throw new Error('Expected disarm action');
        }
        expect(armAction.payload).toEqual({ trackId: 'track-1', armed: true });
        expect(disarmAction.payload).toEqual({ trackId: 'track-1', armed: false });
    });

    it('routes hide/show, disable/enable, fold/unfold to their action types with correct flags', () => {
        const pairs: Array<[string, string, string, Record<string, unknown>, Record<string, unknown>]> = [
            ['hide-track', 'show-track', 'hideTrack', { hidden: true }, { hidden: false }],
            ['disable-track', 'enable-track', 'disableTrack', { disabled: true }, { disabled: false }],
            ['fold-track', 'unfold-track', 'foldTrack', { folded: true }, { folded: false }],
        ];
        for (const [onId, offId, type, onPayload, offPayload] of pairs) {
            const on = trackPresets.find((p) => p.id === onId)!;
            const off = trackPresets.find((p) => p.id === offId)!;
            const onAction = on.buildAction(ctxWithTrack);
            const offAction = off.buildAction(ctxWithTrack);
            if (onAction === null || Array.isArray(onAction)) {
                throw new Error(`Expected action for ${onId}`);
            }
            if (offAction === null || Array.isArray(offAction)) {
                throw new Error(`Expected action for ${offId}`);
            }
            expect(onAction.type).toBe(type);
            expect(onAction.payload).toEqual({ trackId: 'track-1', ...onPayload });
            expect(offAction.payload).toEqual({ trackId: 'track-1', ...offPayload });
        }
    });

    it('returns null for selection-required presets when no track is selected', () => {
        const selectionRequired = trackPresets.filter((p) => p.requiresSelection === 'track');
        for (const preset of selectionRequired) {
            if (preset.id === 'remove-track') {
                continue; // tested separately
            }
            const action = preset.buildAction(ctxNoSelection);
            expect(action).toBeNull();
        }
    });
});

describe('trackPresets — remove-track guard', () => {
    it('returns null when no track is selected', () => {
        const preset = trackPresets.find((p) => p.id === 'remove-track')!;
        expect(preset.buildAction(ctxNoSelection)).toBeNull();
    });

    it('returns null when the selected track is the master track', () => {
        const preset = trackPresets.find((p) => p.id === 'remove-track')!;
        const masterCtx: PresetContext = { ...ctxWithTrack, selectedTrackKind: 'master' };
        expect(preset.buildAction(masterCtx)).toBeNull();
    });

    it('builds removeTrack when a non-master track is selected', () => {
        const preset = trackPresets.find((p) => p.id === 'remove-track')!;
        const action = preset.buildAction(ctxWithTrack);
        if (action === null || Array.isArray(action)) {
            throw new Error('Expected removeTrack action');
        }
        expect(action.type).toBe('removeTrack');
        expect(action.payload).toEqual({ trackId: 'track-1' });
    });
});

describe('trackPresets — global actions', () => {
    it('builds clearSolos without requiring selection', () => {
        const clearSolos = trackPresets.find((p) => p.id === 'clear-solos')!;
        const clearAction = clearSolos.buildAction(ctxNoSelection);
        if (clearAction === null || Array.isArray(clearAction)) {
            throw new Error('Expected clearSolos action');
        }
        expect(clearAction.type).toBe('clearSolos');
    });

    it('does not expose unsupported removeAllTracks through the preset surface', () => {
        const presetActionTypes = trackPresets.flatMap((preset) => {
            const action = preset.buildAction(ctxWithTrack);
            if (action === null) {
                return [];
            }
            return Array.isArray(action) ? action.map((item) => item.type) : [action.type];
        });

        expect(trackPresets.map((preset) => preset.id)).not.toContain('remove-all-tracks');
        expect(presetActionTypes).not.toContain('removeAllTracks');
    });
});
