import { describe, it, expect, vi, afterEach, type MockInstance } from 'vitest';

import { resolveToken, resetResolvedTokenCache } from '../resolveToken';

/**
 * These specs drive the token through jsdom's real cascade — a `<style>` sheet
 * on the document, and a class toggled on `documentElement` — rather than a
 * hand-written stub of `getComputedStyle`. jsdom honours `:root` declarations,
 * class-scoped overrides on the root element, and a `<style>` whose contents are
 * rewritten in place, so each guard exercises the same resolution path the
 * browser takes.
 */
let installedSheets: HTMLStyleElement[] = [];
let computedStyleSpy: MockInstance<typeof getComputedStyle> | null = null;
let observeSpy: MockInstance<MutationObserver['observe']> | null = null;
let disconnectSpy: MockInstance<MutationObserver['disconnect']> | null = null;

const withSheet = (css: string): HTMLStyleElement => {
    const sheet = document.createElement('style');
    sheet.textContent = css;
    document.head.append(sheet);
    installedSheets.push(sheet);
    return sheet;
};

const spyOnComputedStyle = (): MockInstance<typeof getComputedStyle> => {
    computedStyleSpy = vi.spyOn(globalThis, 'getComputedStyle');
    return computedStyleSpy;
};

/**
 * MutationObserver callbacks are delivered as a microtask; a macrotask turn is
 * strictly later than that, so the invalidation has landed by the time this
 * resolves.
 */
const flushObserver = async (): Promise<void> =>
    new Promise((resolve) => {
        setTimeout(resolve, 0);
    });

afterEach(() => {
    for (const sheet of installedSheets) {
        sheet.remove();
    }
    installedSheets = [];
    computedStyleSpy?.mockRestore();
    computedStyleSpy = null;
    observeSpy?.mockRestore();
    observeSpy = null;
    disconnectSpy?.mockRestore();
    disconnectSpy = null;
    document.documentElement.className = '';
    // The cache and the observer are module-global, so they outlive a test.
    // Resetting leaves the next case unarmed and empty, which the observer-
    // lifecycle guards below depend on: they assert `observe` call counts that
    // are only meaningful from a cold start.
    resetResolvedTokenCache();
});

describe('resolveToken', () => {
    it('returns fallback for unresolvable token', () => {
        const result = resolveToken('--nonexistent-token', '#333333');
        expect(result).toBe('#333333');
    });

    it('returns fallback when CSS var not set', () => {
        const result = resolveToken('--another-missing', '#ff0000');
        expect(result).toBe('#ff0000');
    });

    it('returns the declared token value when the cascade resolves it', () => {
        withSheet(':root { --repro-declared: #112233; }');
        expect(resolveToken('--repro-declared', '#000000')).toBe('#112233');
    });

    it('reads the root computed style only once across repeated lookups of one token', () => {
        withSheet(':root { --repro-repeat: #445566; }');
        const spy = spyOnComputedStyle();

        const first = resolveToken('--repro-repeat', '#000000');
        const second = resolveToken('--repro-repeat', '#000000');
        const third = resolveToken('--repro-repeat', '#000000');

        expect([first, second, third]).toEqual(['#445566', '#445566', '#445566']);
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('keys the cache per token instead of latching onto the first one resolved', () => {
        withSheet(':root { --repro-a: #0a0a0a; --repro-b: #0b0b0b; }');
        const spy = spyOnComputedStyle();

        const readings = [
            resolveToken('--repro-a', '#000000'),
            resolveToken('--repro-b', '#000000'),
            resolveToken('--repro-a', '#000000'),
            resolveToken('--repro-b', '#000000'),
        ];

        expect(readings).toEqual(['#0a0a0a', '#0b0b0b', '#0a0a0a', '#0b0b0b']);
        expect(spy).toHaveBeenCalledTimes(2);
    });

    it('returns the new palette value after the theme class changes on the root element', async () => {
        withSheet(':root { --repro-theme: #101010; } .light { --repro-theme: #f0f0f0; }');
        expect(resolveToken('--repro-theme', '#000000')).toBe('#101010');

        // Exactly what Preferences → Appearance does when the user picks light.
        document.documentElement.classList.toggle('light', true);
        await flushObserver();

        expect(resolveToken('--repro-theme', '#000000')).toBe('#f0f0f0');
    });

    it('returns the new palette value after a custom property is written to the root style attribute', async () => {
        withSheet(':root { --repro-inline: #202020; }');
        expect(resolveToken('--repro-inline', '#000000')).toBe('#202020');

        document.documentElement.style.setProperty('--repro-inline', '#e0e0e0');
        await flushObserver();

        expect(resolveToken('--repro-inline', '#000000')).toBe('#e0e0e0');
        document.documentElement.style.removeProperty('--repro-inline');
    });

    it('returns the new palette value after a stylesheet is rewritten in place', async () => {
        // Vite's CSS HMR swaps the injected <style> element's contents and
        // touches no attribute on documentElement, so the root-attribute target
        // alone never sees an edit to tokens.css under `pnpm dev`.
        const sheet = withSheet(':root { --repro-hmr: #303030; }');
        expect(resolveToken('--repro-hmr', '#000000')).toBe('#303030');

        sheet.textContent = ':root { --repro-hmr: #d0d0d0; }';
        await flushObserver();

        expect(resolveToken('--repro-hmr', '#000000')).toBe('#d0d0d0');
    });

    it('arms its observer once no matter how many tokens are resolved', () => {
        withSheet(':root { --repro-arm-a: #010101; --repro-arm-b: #020202; --repro-arm-c: #030303; }');
        observeSpy = vi.spyOn(MutationObserver.prototype, 'observe');

        const readings = [
            resolveToken('--repro-arm-a', '#000000'),
            resolveToken('--repro-arm-b', '#000000'),
            resolveToken('--repro-arm-c', '#000000'),
        ];

        expect(readings).toEqual(['#010101', '#020202', '#030303']);
        // Two targets — documentElement and head — armed exactly once between
        // them, not once per cache miss.
        expect(observeSpy).toHaveBeenCalledTimes(2);
    });

    it('detaches its observer on reset and re-arms on the next lookup', () => {
        withSheet(':root { --repro-cycle: #040404; }');
        observeSpy = vi.spyOn(MutationObserver.prototype, 'observe');
        disconnectSpy = vi.spyOn(MutationObserver.prototype, 'disconnect');

        expect(resolveToken('--repro-cycle', '#000000')).toBe('#040404');
        expect(observeSpy).toHaveBeenCalledTimes(2);

        resetResolvedTokenCache();
        expect(disconnectSpy).toHaveBeenCalledTimes(1);

        // Re-arming proves the reset released the reference too: a reset that
        // disconnected without nulling would leave the cache unwatched forever.
        expect(resolveToken('--repro-cycle', '#000000')).toBe('#040404');
        expect(observeSpy).toHaveBeenCalledTimes(4);
    });

    it('gives each call site its own fallback for a token the cascade cannot resolve', () => {
        // The hazard this guards: one token, two call sites, two different
        // fallbacks — `--color-accent-peach` has been read with both '#f0944c'
        // and '#ffb86c' in this codebase. Declared tokens make the collision
        // latent rather than live, but caching a fallback would hand whichever
        // call site ran second a colour it never asked for, for any token that
        // ever goes undeclared.
        expect(resolveToken('--repro-unset-shared', '#f0944c')).toBe('#f0944c');
        expect(resolveToken('--repro-unset-shared', '#ffb86c')).toBe('#ffb86c');
    });

    it('picks up a token that is declared after the first lookup fell back', () => {
        expect(resolveToken('--repro-late', '#000000')).toBe('#000000');

        withSheet(':root { --repro-late: #778899; }');

        expect(resolveToken('--repro-late', '#000000')).toBe('#778899');
    });

    it('recomputes the root style after the cache is explicitly reset', () => {
        withSheet(':root { --repro-reset: #223344; }');
        expect(resolveToken('--repro-reset', '#000000')).toBe('#223344');

        const spy = spyOnComputedStyle();
        resolveToken('--repro-reset', '#000000');
        expect(spy).toHaveBeenCalledTimes(0);

        resetResolvedTokenCache();
        expect(resolveToken('--repro-reset', '#000000')).toBe('#223344');
        expect(spy).toHaveBeenCalledTimes(1);
    });
});
