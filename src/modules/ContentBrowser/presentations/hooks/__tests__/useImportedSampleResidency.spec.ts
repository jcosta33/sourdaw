import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useImportedSampleResidency } from '../useImportedSampleResidency';

const holdMocks = vi.hoisted(() => {
    const retain = vi.fn();
    const release = vi.fn();
    const openCachedAudioBufferHold = vi.fn(() => ({ retain, release }));
    return { retain, release, openCachedAudioBufferHold };
});

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    openCachedAudioBufferHold: holdMocks.openCachedAudioBufferHold,
}));

describe('useImportedSampleResidency', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('opens one hold and retains each imported buffer id', () => {
        const { result } = renderHook(() => useImportedSampleResidency());
        const hold = result.current();

        hold.retain('import-a');
        hold.retain('import-b');

        expect(holdMocks.openCachedAudioBufferHold).toHaveBeenCalledTimes(1);
        expect(holdMocks.retain).toHaveBeenCalledTimes(2);
        expect(holdMocks.retain).toHaveBeenNthCalledWith(1, 'import-a');
        expect(holdMocks.retain).toHaveBeenNthCalledWith(2, 'import-b');
    });

    it('releases the hold when the sidebar unmounts', () => {
        const { result, unmount } = renderHook(() => useImportedSampleResidency());
        result.current().retain('import-a');
        unmount();
        expect(holdMocks.release).toHaveBeenCalled();
    });
});
