import { describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { isCreatePatternInstanceSessionEntry } from '../isCreatePatternInstanceSessionEntry';

type CreatePayload = Extract<AppAction, { type: 'createPatternInstance' }>['payload'];

function create(overrides: Partial<CreatePayload> = {}): AppAction {
    return {
        type: 'createPatternInstance',
        payload: {
            sourceClipId: 'pattern',
            targetTrackId: 'track',
            startBeat: 16,
            targetClipId: 'clip-inst-1',
            ...overrides,
        },
    };
}

function discard(clipId: string): AppAction {
    return { type: 'discardDuplicatedClip', payload: { clipId } };
}

describe('isCreatePatternInstanceSessionEntry', () => {
    it('accepts an entry whose inverse removes exactly the instance the action names', () => {
        expect(isCreatePatternInstanceSessionEntry({ action: create(), inverseAction: discard('clip-inst-1') })).toBe(
            true
        );
    });

    it.each([
        ['an inverse that removes another clip', { action: create(), inverseAction: discard('other') }],
        [
            'an action that names no instance id',
            { action: create({ targetClipId: undefined }), inverseAction: discard('clip-inst-1') },
        ],
        [
            'an action that names an empty instance id',
            { action: create({ targetClipId: '' }), inverseAction: discard('') },
        ],
        ['no inverse', { action: create(), inverseAction: null }],
        ['an inverse that is not a discard', { action: create(), inverseAction: create() }],
        ['a separate redo', { action: create(), inverseAction: discard('clip-inst-1'), redoAction: create() }],
        ['an empty source clip', { action: create({ sourceClipId: '' }), inverseAction: discard('clip-inst-1') }],
        [
            'an empty destination track',
            { action: create({ targetTrackId: '' }), inverseAction: discard('clip-inst-1') },
        ],
        ['a negative start beat', { action: create({ startBeat: -1 }), inverseAction: discard('clip-inst-1') }],
        [
            'a non-finite start beat',
            { action: create({ startBeat: Number.NaN }), inverseAction: discard('clip-inst-1') },
        ],
        ['an entry of another action', { action: discard('clip-inst-1'), inverseAction: discard('clip-inst-1') }],
    ])('rejects %s', (_name, entry) => {
        expect(isCreatePatternInstanceSessionEntry(entry)).toBe(false);
    });
});
