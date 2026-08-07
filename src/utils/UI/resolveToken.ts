/**
 * Resolved CSS custom properties, keyed by property name.
 *
 * Only *non-empty* computed values are stored. An unresolvable token is
 * deliberately left out so that (a) two call sites that pass different
 * fallbacks for the same unset token each get their own fallback rather than
 * whichever one happened to run first, and (b) a token that is not declared
 * yet — a stylesheet still loading, a device panel that injects its palette on
 * mount — starts resolving as soon as it exists instead of being pinned to a
 * fallback for the lifetime of the page.
 */
const resolvedTokens = new Map<string, string>();

/**
 * One observer covering both ways a resolved custom property can move.
 *
 * 1. An attribute change on `documentElement` — the element the tokens are read
 *    from. The theme switch in `Preferences/…/AppearanceSection.tsx` toggles the
 *    `dark` / `light` classes, and any future accent-colour control would write
 *    through `style` (`setProperty('--color-…')`).
 * 2. A stylesheet change inside `<head>` — a `<style>` whose contents are
 *    swapped, or a sheet appended after first paint. This is what Vite's CSS
 *    HMR does when `tokens.css` is edited under `pnpm dev`: it rewrites the
 *    injected `<style>` element's text and touches no attribute on
 *    `documentElement` at all. Without this target, editing the palette in dev
 *    would leave every canvas painting the previous colours until a full
 *    reload — a regression the cache would otherwise introduce.
 *
 * `subtree` is required because the mutation lands on the `<style>` element,
 * not on `<head>` itself. Both options here are load-bearing; each has a guard.
 */
let tokenSourceObserver: MutationObserver | null = null;

function observeTokenSources(): void {
    if (tokenSourceObserver) {
        return;
    }
    tokenSourceObserver = new MutationObserver(() => {
        resolvedTokens.clear();
    });
    tokenSourceObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'style'],
    });
    tokenSourceObserver.observe(document.head, {
        childList: true,
        subtree: true,
    });
}

/**
 * Drops every cached token and detaches the observer. The next `resolveToken`
 * call recomputes from the live cascade and re-arms, so this is safe to call at
 * any time.
 *
 * Nulling the reference is what allows that re-arm: `observeTokenSources` treats
 * a non-null reference as "already watching" and returns early, so a reset that
 * disconnected without nulling would leave the cache permanently unwatched.
 *
 * Exists for tests, which share one `document` across a file and would otherwise
 * inherit both the values and the observer of an earlier case.
 */
export function resetResolvedTokenCache(): void {
    resolvedTokens.clear();
    tokenSourceObserver?.disconnect();
    tokenSourceObserver = null;
}

/**
 * Resolves a CSS custom property to its computed value.
 * Used for canvas/SVG contexts that need raw color strings instead of `var(--token)`.
 *
 * `getComputedStyle` forces the browser to flush pending style — from inside a
 * canvas draw path (and several of these run on every animation frame, some
 * once per track or per contour point) that recalculation is paid on every
 * call. The values themselves only move when the theme or a stylesheet does, so
 * they are cached and invalidated on exactly those signals.
 *
 * Falls back to the provided `fallback` when `document` is unavailable (SSR / test).
 */
export function resolveToken(property: string, fallback: string): string {
    if (typeof document === 'undefined') {
        return fallback;
    }

    const cached = resolvedTokens.get(property);
    if (cached !== undefined) {
        return cached;
    }

    observeTokenSources();

    const value = getComputedStyle(document.documentElement).getPropertyValue(property).trim();
    if (!value) {
        return fallback;
    }

    resolvedTokens.set(property, value);
    return value;
}
