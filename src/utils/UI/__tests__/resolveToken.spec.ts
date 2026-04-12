import { describe, it, expect, vi, afterEach } from 'vitest';

import { resolveToken } from '../resolveToken';

describe('resolveToken', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should return the fallback when the custom property is empty', () => {
        vi.spyOn(window, 'getComputedStyle').mockReturnValue({
            getPropertyValue: () => '',
        } as unknown as CSSStyleDeclaration);

        expect(resolveToken('--missing', '#112233')).toBe('#112233');
    });

    it('should trim the computed custom property value', () => {
        vi.spyOn(window, 'getComputedStyle').mockReturnValue({
            getPropertyValue: () => '  #aabbcc  ',
        } as unknown as CSSStyleDeclaration);

        expect(resolveToken('--color', '#000')).toBe('#aabbcc');
    });
});
