import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveCanvasColor, resolveToken } from '../resolveToken';

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

describe('resolveCanvasColor', () => {
    it('should return the fallback when the color string is empty', () => {
        expect(resolveCanvasColor('', '#fallback')).toBe('#fallback');
    });

    it('should return non-var colors unchanged', () => {
        expect(resolveCanvasColor('#ff00aa', '#000')).toBe('#ff00aa');
        expect(resolveCanvasColor('rgb(1,2,3)', '#000')).toBe('rgb(1,2,3)');
    });

    it('should resolve var(--token) via resolveToken', () => {
        vi.spyOn(window, 'getComputedStyle').mockReturnValue({
            getPropertyValue: () => '#deadbeef',
        } as unknown as CSSStyleDeclaration);

        expect(resolveCanvasColor('var(--timeline-grid)', '#000')).toBe('#deadbeef');
    });

    it('should use the var() fallback segment when the property is empty', () => {
        vi.spyOn(window, 'getComputedStyle').mockReturnValue({
            getPropertyValue: () => '',
        } as unknown as CSSStyleDeclaration);

        expect(resolveCanvasColor('var(--x, #backup)', '#000')).toBe('#backup');
    });
});
