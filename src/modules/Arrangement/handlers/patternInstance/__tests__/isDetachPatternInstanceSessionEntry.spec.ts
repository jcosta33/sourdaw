import { describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { isDetachPatternInstanceSessionEntry } from '../isDetachPatternInstanceSessionEntry';

type RestorePayload = Extract<AppAction, { type: 'restorePatternInstanceLink' }>['payload'];

const unlinked = { parentClipId: { present: false }, overrides: { present: false } } as const;
const linked = {
    parentClipId: { present: true, value: 'pattern' },
    overrides: { present: true, value: { notes: true } },
} as const;

const forward: AppAction = { type: 'detachPatternInstance', payload: { clipId: 'instance' } };

function restore(overrides: Partial<RestorePayload> = {}): AppAction {
    return {
        type: 'restorePatternInstanceLink',
        payload: { clipId: 'instance', trackId: 'track', expected: unlinked, replacement: linked, ...overrides },
    };
}

const inverse = restore();
const redo = restore({ expected: linked, replacement: unlinked });

describe('isDetachPatternInstanceSessionEntry', () => {
    it('accepts the entry the handler describes', () => {
        expect(isDetachPatternInstanceSessionEntry({ action: forward, inverseAction: inverse, redoAction: redo })).toBe(
            true
        );
    });

    it('accepts an entry that recorded no inverse and no redo', () => {
        expect(isDetachPatternInstanceSessionEntry({ action: forward, inverseAction: null })).toBe(true);
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
                redoAction: restore({ clipId: 'other', expected: linked, replacement: unlinked }),
            },
        ],
        [
            'a redo on another track',
            {
                action: forward,
                inverseAction: inverse,
                redoAction: restore({ trackId: 'elsewhere', expected: linked, replacement: unlinked }),
            },
        ],
        [
            'an inverse guarded on a still-linked clip',
            { action: forward, inverseAction: restore({ expected: linked }), redoAction: redo },
        ],
        [
            'an inverse that restores no link',
            {
                action: forward,
                inverseAction: restore({ replacement: unlinked }),
                redoAction: restore({ expected: unlinked, replacement: unlinked }),
            },
        ],
        [
            'an inverse that restores an empty parent',
            {
                action: forward,
                inverseAction: restore({
                    replacement: { parentClipId: { present: true, value: '' }, overrides: { present: false } },
                }),
                redoAction: redo,
            },
        ],
        [
            'a redo guarded on a different link',
            {
                action: forward,
                inverseAction: inverse,
                redoAction: restore({
                    expected: { parentClipId: { present: true, value: 'rival' }, overrides: { present: false } },
                    replacement: unlinked,
                }),
            },
        ],
        [
            'a redo that leaves the clip linked',
            { action: forward, inverseAction: inverse, redoAction: restore({ expected: linked, replacement: linked }) },
        ],
        ['an inverse that is not a link restore', { action: forward, inverseAction: forward, redoAction: redo }],
        [
            'an entry of another action',
            {
                action: { type: 'removeClip', payload: { clipId: 'instance' } } as AppAction,
                inverseAction: inverse,
                redoAction: redo,
            },
        ],
    ])('rejects %s', (_name, entry) => {
        expect(isDetachPatternInstanceSessionEntry(entry)).toBe(false);
    });
});
