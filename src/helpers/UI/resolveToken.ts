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

const VAR_RE = /^var\(\s*(--[^),]+)\s*(?:,\s*(.+))?\)$/;

/**
 * Resolves a color string that may be a `var(--token)` expression to a canvas-safe value.
 * If the input is already a hex/rgb/named string, returns it unchanged.
 * Returns `fallback` when the input is empty or cannot be resolved.
 */
export function resolveCanvasColor(color: string, fallback: string): string {
    if (!color) {
        return fallback;
    }
    const match = VAR_RE.exec(color);
    if (!match) {
        return color;
    }
    return resolveToken(match[1]!, match[2] ?? fallback);
}
