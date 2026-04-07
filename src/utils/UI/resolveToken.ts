/**
 * Resolves a CSS custom property to its computed value.
 * Used for canvas/SVG contexts that need raw color strings instead of `var(--token)`.
 *
 * Falls back to the provided `fallback` when `document` is unavailable (SSR / test).
 */
export function resolveToken(property: string, fallback: string): string {
    if (typeof document === 'undefined') {
        return fallback;
    }
    const value = getComputedStyle(document.documentElement).getPropertyValue(property).trim();
    return value || fallback;
}
