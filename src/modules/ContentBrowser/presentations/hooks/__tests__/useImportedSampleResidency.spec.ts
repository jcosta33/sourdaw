import { StrictMode, createElement, type ReactNode } from 'react';

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

    it('returns the same hold from repeated getter calls and opens only once', () => {
        const { result } = renderHook(() => useImportedSampleResidency());
        const first = result.current();
        const second = result.current();

        expect(first).not.toBeNull();
        expect(second).toBe(first);
        expect(holdMocks.openCachedAudioBufferHold).toHaveBeenCalledTimes(1);
    });

    it('opens one hold and retains each imported buffer id', () => {
        const { result } = renderHook(() => useImportedSampleResidency());
        const hold = result.current();
        if (hold === null) {
            throw new Error('Expected an import residency hold');
        }

        hold.retain('import-a');
        hold.retain('import-b');

        expect(holdMocks.openCachedAudioBufferHold).toHaveBeenCalledTimes(1);
        expect(holdMocks.retain).toHaveBeenCalledTimes(2);
        expect(holdMocks.retain).toHaveBeenNthCalledWith(1, 'import-a');
        expect(holdMocks.retain).toHaveBeenNthCalledWith(2, 'import-b');
    });

    it('releases the hold when the sidebar unmounts', () => {
        const { result, unmount } = renderHook(() => useImportedSampleResidency());
        const hold = result.current();
        if (hold === null) {
            throw new Error('Expected an import residency hold');
        }
        hold.retain('import-a');
        unmount();
        expect(holdMocks.release).toHaveBeenCalled();
    });

    it('opens no hold after unmount and the getter returns null', () => {
        const { result, unmount } = renderHook(() => useImportedSampleResidency());
        expect(result.current()).not.toBeNull();
        unmount();
        vi.clearAllMocks();
        expect(result.current()).toBeNull();
        expect(holdMocks.openCachedAudioBufferHold).not.toHaveBeenCalled();
    });

    it('keeps one hold through a StrictMode double mount', () => {
        const { result } = renderHook(() => useImportedSampleResidency(), {
            wrapper: ({ children }: { children: ReactNode }) => createElement(StrictMode, null, children),
        });
        const first = result.current();
        const second = result.current();

        expect(first).not.toBeNull();
        expect(second).toBe(first);
        expect(holdMocks.openCachedAudioBufferHold).toHaveBeenCalledTimes(1);
        expect(holdMocks.release).not.toHaveBeenCalled();
    });
});
