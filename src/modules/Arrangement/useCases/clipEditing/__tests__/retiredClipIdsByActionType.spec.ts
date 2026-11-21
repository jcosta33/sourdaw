import { describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { retiredClipIds } from '../retiredClipIdsByActionType';

const source = ClipDummy.create({ id: 'source', trackId: 'track' });
const emptyMidi = {
    notes: { present: false, value: [] },
    controlChanges: { present: false, value: [] },
    pitchBends: { present: false, value: [] },
};

function restoreSplitState(withRightClip: boolean): AppAction {
    const state = {
        trackId: 'track',
        leftClip: source,
        rightClip: withRightClip ? { ...source, id: 'split-right' } : null,
        rightClipIndex: 1,
        sourceMidi: emptyMidi,
        rightMidi: emptyMidi,
    };
    return {
        type: 'restoreClipSplitState',
        payload: { clipId: source.id, rightClipId: 'split-right', expected: state, replacement: state },
    };
}

describe('retiredClipIds', () => {
    it.each([
        ['removeClip', { type: 'removeClip', payload: { clipId: 'gone' } }],
        ['discardDuplicatedClip', { type: 'discardDuplicatedClip', payload: { clipId: 'gone' } }],
    ] satisfies [string, AppAction][])('retires the clip a %s removes', (_type, action) => {
        expect(retiredClipIds(action)).toEqual(['gone']);
    });

    it('retires the right clip of a split state restored without one', () => {
        expect(retiredClipIds(restoreSplitState(false))).toEqual(['split-right']);
    });

    it('retires nothing when the restored split state keeps its right clip', () => {
        expect(retiredClipIds(restoreSplitState(true))).toEqual([]);
    });

    it('retires nothing for an action name that is only inherited, read from untrusted JSON', () => {
        const parsed: AppAction = JSON.parse('{"type":"constructor","payload":{"clipId":"kept"}}');

        expect(retiredClipIds(parsed)).toEqual([]);
    });

    it('retires nothing for an action that leaves clips in place', () => {
        const action = { type: 'renameClip', payload: { clipId: 'kept', name: 'Other' } } satisfies AppAction;

        expect(retiredClipIds(action)).toEqual([]);
    });
});
