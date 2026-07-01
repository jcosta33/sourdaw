import { describe, it, expect, vi, beforeEach } from 'vitest';

import { isNativeAiRuntimeAvailable as readNativeAiRuntimeAvailability } from '../../../../repositories/nativeEngine/isNativeAiRuntimeAvailable';
import { isNativeAiRuntimeAvailable } from '../isNativeAiRuntimeAvailable';

vi.mock('../../../../repositories/nativeEngine/isNativeAiRuntimeAvailable', () => ({
    isNativeAiRuntimeAvailable: vi.fn(),
}));

describe('isNativeAiRuntimeAvailable use case', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return true when the native runtime repository reports availability', () => {
        vi.mocked(readNativeAiRuntimeAvailability).mockReturnValue(true);

        expect(isNativeAiRuntimeAvailable()).toBe(true);
    });

    it('should return false when the native runtime repository reports no availability', () => {
        vi.mocked(readNativeAiRuntimeAvailability).mockReturnValue(false);

        expect(isNativeAiRuntimeAvailable()).toBe(false);
    });
});
