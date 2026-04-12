import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../stores/preferencesStore', () => ({
    preferencesStore: {
        value: { trackHeight: 'normal' as const, theme: 'dark' as const },
        set: vi.fn(),
    },
}));

import { setTrackHeight } from '../setTrackHeight';
import { preferencesStore } from '../../stores/preferencesStore';

describe('setTrackHeight', () => {
    beforeEach(() => {
        vi.mocked(preferencesStore.set).mockClear();
    });

    it('writes the new height onto the existing prefs', () => {
        setTrackHeight('large');
        expect(preferencesStore.set).toHaveBeenCalledWith(
            expect.objectContaining({ trackHeight: 'large' })
        );
    });

    it('noops when prefs are missing', () => {
        // @ts-expect-error — overriding mock for null branch
        preferencesStore.value = null;
        setTrackHeight('large');
        expect(preferencesStore.set).not.toHaveBeenCalled();
    });
});
