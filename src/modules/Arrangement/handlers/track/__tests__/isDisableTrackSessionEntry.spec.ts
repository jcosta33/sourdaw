import { describe, expect, it, vi } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { handleDisableTrack } from '../disableTrack';
import { isDisableTrackSessionEntry } from '../isDisableTrackSessionEntry';

type DisableAction = Extract<AppAction, { type: 'disableTrack' }>;

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: () => null,
}));

const forward: DisableAction = { type: 'disableTrack', payload: { trackId: 't1', disabled: true } };
const inverse: AppAction = {
    type: 'restoreTrackDisabled',
    payload: { trackId: 't1', expected: true, replacement: false },
};
const redo: AppAction = {
    type: 'restoreTrackDisabled',
    payload: { trackId: 't1', expected: false, replacement: true },
};

describe('isDisableTrackSessionEntry', () => {
    it('accepts the entry the handler describes', () => {
        expect(isDisableTrackSessionEntry({ action: forward, inverseAction: inverse, redoAction: redo })).toBe(true);
    });

    it.each([
        [
            'an inverse for another track',
            { ...inverse, payload: { trackId: 't2', expected: true, replacement: false } },
            redo,
        ],
        [
            'an inverse expecting a state the action did not leave',
            { ...inverse, payload: { trackId: 't1', expected: false, replacement: false } },
            redo,
        ],
        [
            'a redo that does not write the action state',
            inverse,
            { ...redo, payload: { trackId: 't1', expected: false, replacement: false } },
        ],
        [
            'a redo that does not start where the inverse ends',
            inverse,
            { ...redo, payload: { trackId: 't1', expected: true, replacement: true } },
        ],
        ['an inverse of another action type', { type: 'hideTrack', payload: { trackId: 't1', hidden: false } }, redo],
        ['no redo', inverse, undefined],
    ] as const)('refuses %s', (_name, badInverse, badRedo) => {
        expect(
            isDisableTrackSessionEntry({
                action: forward,
                inverseAction: badInverse,
                redoAction: badRedo,
            })
        ).toBe(false);
    });

    it('accepts the entry the handler describes for a track it cannot find outside a batch', () => {
        const description = handleDisableTrack.describe(forward);

        expect(description.inverseAction).toBeNull();
        expect(description.redoAction).toBeUndefined();
        expect(
            isDisableTrackSessionEntry({
                action: forward,
                inverseAction: description.inverseAction ?? null,
                redoAction: description.redoAction,
            })
        ).toBe(true);
    });

    it('refuses an entry with no inverse that still carries a redo', () => {
        expect(isDisableTrackSessionEntry({ action: forward, inverseAction: null, redoAction: redo })).toBe(false);
    });

    it('refuses an entry whose forward action is not a disable', () => {
        expect(
            isDisableTrackSessionEntry({
                action: { type: 'hideTrack', payload: { trackId: 't1', hidden: true } },
                inverseAction: inverse,
                redoAction: redo,
            })
        ).toBe(false);
    });
});
