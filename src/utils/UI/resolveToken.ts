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
 * Watches the element the tokens are read from. The only runtime mutation in
 * this app that can change a resolved custom property on `documentElement` is
 * an attribute change on that element: the theme switch in
 * `Preferences/…/AppearanceSection.tsx` toggles the `dark` / `light` classes,
 * and any future accent-colour control would write through `style`
 * (`setProperty('--color-…')`). Both are covered; nothing else is watched,
 * because nothing else can move the values.
 */
let rootAttributeObserver: MutationObserver | null = null;

function observeRootAttributes(): void {
    if (rootAttributeObserver) {
        return;
    }
    rootAttributeObserver = new MutationObserver(() => {
        resolvedTokens.clear();
    });
    rootAttributeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'style'],
    });
}

/**
 * Drops every cached token and stops watching the root element. The next
 * `resolveToken` call recomputes from the live cascade and re-arms the
 * observer, so this is safe to call at any time.
 *
 * Exists for tests, which share one `document` across a file and would
 * otherwise inherit values resolved by an earlier case.
 */
export function resetResolvedTokenCache(): void {
    resolvedTokens.clear();
    rootAttributeObserver?.disconnect();
    rootAttributeObserver = null;
}

/**
 * Resolves a CSS custom property to its computed value.
 * Used for canvas/SVG contexts that need raw color strings instead of `var(--token)`.
 *
 * `getComputedStyle` forces the browser to flush pending style — from inside a
 * canvas draw path (and several of these run on every animation frame, some
 * once per track or per contour point) that recalculation is paid on every
 * call. The values themselves only move when the theme does, so they are
 * cached and invalidated on the root attribute change that moves them.
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

    observeRootAttributes();

    const value = getComputedStyle(document.documentElement).getPropertyValue(property).trim();
    if (!value) {
        return fallback;
    }

    resolvedTokens.set(property, value);
    return value;
}
