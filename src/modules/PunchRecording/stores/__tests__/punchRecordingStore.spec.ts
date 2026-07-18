import { describe, it, expect, beforeEach } from 'vitest';

import { punchRecordingStore } from '../punchRecordingStore';

describe('punchRecordingStore', () => {
    beforeEach(() => {
        punchRecordingStore.set({
            captures: [],
            defaultPreRoll: 4,
            defaultPostRoll: 2,
            defaultCrossfade: 0.25,
            enabled: false,
        });
    });

    it('should have initial state', () => {
        expect(punchRecordingStore.value?.captures).toHaveLength(0);
        expect(punchRecordingStore.value?.enabled).toBe(false);
    });

    it('should update state', () => {
        punchRecordingStore.update((state) => ({ ...state!, enabled: true }));
        expect(punchRecordingStore.value?.enabled).toBe(true);
    });
});
