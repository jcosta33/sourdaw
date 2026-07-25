import { describe, it, expect, vi, beforeEach } from 'vitest';

import * as subject from '../setSectionColor';

const mocks = vi.hoisted(() => ({
    storeValue: { value: null as { markers: unknown[]; sections: { id: string; color: string }[] } | null },
    storeSet: vi.fn(),
}));

vi.mock('../../../../stores/markerStore', () => ({
    markerStore: {
        get value() {
            return mocks.storeValue.value;
        },
        set: mocks.storeSet,
    },
}));

describe('setSectionColor', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.storeValue.value = null;
    });

    it('recolors only the targeted arrangement section', () => {
        mocks.storeValue.value = {
            markers: [],
            sections: [
                { id: 'intro', color: '#ff0000' },
                { id: 'drop', color: '#00ff00' },
            ],
        };

        subject.setSectionColor('drop', '#0000ff');

        expect(mocks.storeSet).toHaveBeenCalledTimes(1);
        const next = mocks.storeSet.mock.calls[0]?.[0] as {
            sections: { id: string; color: string }[];
        };
        expect(next.sections).toEqual([
            { id: 'intro', color: '#ff0000' },
            { id: 'drop', color: '#0000ff' },
        ]);
    });

    it('writes nothing when the marker store has not loaded', () => {
        mocks.storeValue.value = null;

        subject.setSectionColor('intro', '#ffffff');

        expect(mocks.storeSet).not.toHaveBeenCalled();
    });
});
