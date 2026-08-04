import { describe, it, expect, vi, beforeEach } from 'vitest';

import * as subject from '../renameSection';

const mocks = vi.hoisted(() => ({
    storeValue: { value: null as { markers: unknown[]; sections: { id: string; name: string }[] } | null },
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

describe('renameSection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.storeValue.value = null;
    });

    it('renames only the targeted arrangement section and leaves siblings untouched', () => {
        mocks.storeValue.value = {
            markers: [],
            sections: [
                { id: 'intro', name: 'Intro' },
                { id: 'drop', name: 'Drop' },
            ],
        };

        const changed = subject.renameSection('drop', 'Chorus');

        expect(changed).toBe(true);
        expect(mocks.storeSet).toHaveBeenCalledTimes(1);
        const next = mocks.storeSet.mock.calls[0]?.[0] as {
            sections: { id: string; name: string }[];
        };
        expect(next.sections).toEqual([
            { id: 'intro', name: 'Intro' },
            { id: 'drop', name: 'Chorus' },
        ]);
    });

    it('preserves the other top-level store state (markers) in the write', () => {
        const markers = [{ id: 'm1', beat: 0, name: 'Start', color: '#fff' }];
        mocks.storeValue.value = {
            markers,
            sections: [{ id: 'intro', name: 'Intro' }],
        };

        const changed = subject.renameSection('intro', 'Verse');

        expect(changed).toBe(true);
        const next = mocks.storeSet.mock.calls[0]?.[0] as { markers: unknown[] };
        expect(next.markers).toBe(markers);
    });

    it('writes nothing when the marker store has not loaded', () => {
        mocks.storeValue.value = null;

        const changed = subject.renameSection('intro', 'Verse');

        expect(changed).toBe(false);
        expect(mocks.storeSet).not.toHaveBeenCalled();
    });

    it('writes nothing when the section is missing or already has the requested name', () => {
        mocks.storeValue.value = {
            markers: [],
            sections: [{ id: 'intro', name: 'Intro' }],
        };

        const missing = subject.renameSection('missing', 'Verse');
        const unchanged = subject.renameSection('intro', 'Intro');

        expect(missing).toBe(false);
        expect(unchanged).toBe(false);
        expect(mocks.storeSet).not.toHaveBeenCalled();
    });
});
