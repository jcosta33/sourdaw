import { describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { isReverseClipSessionEntry } from '../isReverseClipSessionEntry';

type RestorePayload = Extract<AppAction, { type: 'restoreReversedClip' }>['payload'];

const forward: AppAction = { type: 'reverseClip', payload: { clipId: 'verse', reversedBufferId: 'reversed-1' } };

function restore(overrides: Partial<RestorePayload>): AppAction {
    return {
        type: 'restoreReversedClip',
        payload: {
            clipId: 'verse',
            expectedAudioBufferId: 'reversed-1',
            audioBufferId: 'source',
            name: 'Verse',
            fadeInBeats: 1,
            fadeOutBeats: 0.25,
            ...overrides,
        },
    };
}

const inverse = restore({});
const redo = restore({
    expectedAudioBufferId: 'source',
    audioBufferId: 'reversed-1',
    name: 'Verse (reversed)',
    fadeInBeats: 0.25,
    fadeOutBeats: 1,
});

describe('isReverseClipSessionEntry', () => {
    it('accepts the entry the handler describes', () => {
        expect(isReverseClipSessionEntry({ action: forward, inverseAction: inverse, redoAction: redo })).toBe(true);
    });

    it('accepts an entry that recorded no inverse and no redo', () => {
        expect(isReverseClipSessionEntry({ action: forward, inverseAction: null })).toBe(true);
    });

    it.each([
        ['a redo beside no inverse', { action: forward, inverseAction: null, redoAction: redo }],
        ['an inverse beside no redo', { action: forward, inverseAction: inverse }],
        [
            'an inverse on another clip',
            { action: forward, inverseAction: restore({ clipId: 'other' }), redoAction: redo },
        ],
        [
            'a redo on another clip',
            {
                action: forward,
                inverseAction: inverse,
                redoAction: restore({
                    clipId: 'other',
                    expectedAudioBufferId: 'source',
                    audioBufferId: 'reversed-1',
                    name: 'Verse (reversed)',
                    fadeInBeats: 0.25,
                    fadeOutBeats: 1,
                }),
            },
        ],
        [
            'an inverse guarded on another buffer',
            { action: forward, inverseAction: restore({ expectedAudioBufferId: 'later' }), redoAction: redo },
        ],
        [
            'a redo that restores another buffer',
            {
                action: forward,
                inverseAction: inverse,
                redoAction: restore({
                    expectedAudioBufferId: 'source',
                    audioBufferId: 'rival',
                    name: 'Verse (reversed)',
                    fadeInBeats: 0.25,
                    fadeOutBeats: 1,
                }),
            },
        ],
        [
            'a redo guarded on another buffer',
            {
                action: forward,
                inverseAction: inverse,
                redoAction: restore({
                    expectedAudioBufferId: 'later',
                    audioBufferId: 'reversed-1',
                    name: 'Verse (reversed)',
                    fadeInBeats: 0.25,
                    fadeOutBeats: 1,
                }),
            },
        ],
        [
            'an inverse that restores the reversed buffer',
            { action: forward, inverseAction: restore({ audioBufferId: 'reversed-1' }), redoAction: redo },
        ],
        [
            'an inverse that restores no buffer',
            { action: forward, inverseAction: restore({ audioBufferId: '' }), redoAction: redo },
        ],
        [
            'a redo that does not suffix the name',
            {
                action: forward,
                inverseAction: inverse,
                redoAction: restore({
                    expectedAudioBufferId: 'source',
                    audioBufferId: 'reversed-1',
                    name: 'Verse',
                    fadeInBeats: 0.25,
                    fadeOutBeats: 1,
                }),
            },
        ],
        [
            'a redo that keeps the fades unmirrored',
            {
                action: forward,
                inverseAction: inverse,
                redoAction: restore({
                    expectedAudioBufferId: 'source',
                    audioBufferId: 'reversed-1',
                    name: 'Verse (reversed)',
                    fadeInBeats: 1,
                    fadeOutBeats: 0.25,
                }),
            },
        ],
        [
            'an action that names no minted buffer',
            {
                action: { type: 'reverseClip', payload: { clipId: 'verse' } } as AppAction,
                inverseAction: inverse,
                redoAction: redo,
            },
        ],
        ['an inverse that is not a reverse restore', { action: forward, inverseAction: forward, redoAction: redo }],
        [
            'an entry of another action',
            {
                action: { type: 'removeClip', payload: { clipId: 'verse' } } as AppAction,
                inverseAction: inverse,
                redoAction: redo,
            },
        ],
    ])('rejects %s', (_name, entry) => {
        expect(isReverseClipSessionEntry(entry)).toBe(false);
    });
});
