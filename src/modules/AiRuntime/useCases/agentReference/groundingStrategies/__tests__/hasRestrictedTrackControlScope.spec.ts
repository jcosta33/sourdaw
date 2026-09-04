import { describe, expect, it } from 'vitest';

import { hasRestrictedTrackControlScope } from '../hasRestrictedTrackControlScope';

const tracks = [
    { id: 'track-vocals', name: 'Vocals' },
    { id: 'track-guitar', name: 'Guitar' },
    { id: 'track-room-mic', name: 'Room Mic' },
    { id: 'track-drum-bus', name: 'Drum Bus' },
] as const;

describe('hasRestrictedTrackControlScope', () => {
    it('treats mute all audio tracks as unrestricted', () => {
        expect(hasRestrictedTrackControlScope('mute all audio tracks', { tracks })).toBe(false);
    });

    it('keeps mute all audio tracks but Vocals restricted', () => {
        expect(hasRestrictedTrackControlScope('mute all audio tracks but Vocals', { tracks })).toBe(true);
    });

    it('does not treat a named mix mute with a leaving-unchanged qualifier as universal restricted scope', () => {
        const prompt =
            'Set Lead Vocal gain to 70%, pan Guitar Left 20% left and Guitar Right 20% right, and mute Room Mic, leaving the Drum Bus unchanged.';
        expect(hasRestrictedTrackControlScope(prompt, { tracks })).toBe(false);
    });
});
