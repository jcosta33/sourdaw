import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultPreferences } from '../../models/Preferences';
import { setTimelineMinimapHeight } from '../setTimelineMinimapHeight';

const mocks = vi.hoisted(() => ({
    value: { current: null as typeof defaultPreferences | null },
    trySet: vi.fn(),
}));

vi.mock('../../stores/preferencesStore', () => ({
    preferencesStore: {
        get value() {
            return mocks.value.current;
        },
        trySet: mocks.trySet,
    },
}));

describe('setTimelineMinimapHeight', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.value.current = { ...defaultPreferences, timelineMinimapHeight: 64 };
    });

    it.each([
        { input: 72.7, expected: 73 },
        { input: 0, expected: 28 },
        { input: 999, expected: 160 },
        { input: Number.NaN, expected: 28 },
    ])('normalizes $input and persists $expected through Preferences', ({ input, expected }) => {
        setTimelineMinimapHeight(input);

        expect(mocks.trySet).toHaveBeenCalledTimes(1);
        expect(mocks.trySet).toHaveBeenCalledWith({
            ...defaultPreferences,
            timelineMinimapHeight: expected,
        });
    });

    it('does nothing before Preferences has initialized', () => {
        mocks.value.current = null;

        setTimelineMinimapHeight(80);

        expect(mocks.trySet).not.toHaveBeenCalled();
    });
});
