import { describe, expect, it } from 'vitest';

import { type PresetContext } from '../Types';
import { clipAction, trackAction } from '../Types';

const ctxWithSelection: PresetContext = {
    selectedTrackId: 'track-7',
    selectedClipId: 'clip-3',
    selectedClipType: 'midi',
    trackCount: 2,
};

const ctxNoSelection: PresetContext = {
    selectedTrackId: undefined,
    selectedClipId: undefined,
    selectedClipType: undefined,
    trackCount: 0,
};

describe('trackAction', () => {
    it('emits a typed action with the payload projected from the selected track id', () => {
        const build = trackAction('setTrackColor', (trackId) => ({ trackId, color: '#f00' }));
        const action = build(ctxWithSelection);
        if (action === null || Array.isArray(action)) {
            throw new Error('Expected a single action');
        }
        expect(action.type).toBe('setTrackColor');
        expect(action.payload).toEqual({ trackId: 'track-7', color: '#f00' });
    });

    it('returns null when no track is selected', () => {
        const build = trackAction('setTrackColor', (trackId) => ({ trackId }));
        expect(build(ctxNoSelection)).toBeNull();
    });
});

describe('clipAction', () => {
    it('emits a typed action with the payload projected from the selected clip id', () => {
        const build = clipAction('removeClip', (clipId) => ({ clipId, cascade: true }));
        const action = build(ctxWithSelection);
        if (action === null || Array.isArray(action)) {
            throw new Error('Expected a single action');
        }
        expect(action.type).toBe('removeClip');
        expect(action.payload).toEqual({ clipId: 'clip-3', cascade: true });
    });

    it('returns null when no clip is selected', () => {
        const build = clipAction('removeClip', (clipId) => ({ clipId }));
        expect(build(ctxNoSelection)).toBeNull();
    });
});
