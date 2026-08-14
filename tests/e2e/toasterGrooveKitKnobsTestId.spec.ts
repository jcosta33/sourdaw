import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openToaster(page: import('@playwright/test').Page): Promise<void> {
    const search = page.getByTestId('browser-search');
    if (!(await search.isVisible().catch(() => false))) {
        await page.getByTestId('toggle-browser').click();
        await page.waitForTimeout(500);
    }
    await search.fill('toaster');
    await page.waitForTimeout(500);
    // The Toaster card must be reachable; if it is not, fail rather than skip.
    const card = page.getByRole('button', { name: /^Toaster/i }).first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();
    // Panel-mounted contract: the first pad renders once ToasterPanel is up.
    await expect(page.getByTestId('toaster-pad-0')).toBeVisible({ timeout: 15_000 });
}

async function readSliderValue(
    page: import('@playwright/test').Page,
    label: string
): Promise<number> {
    const knob = page.getByRole('slider', { name: label });
    return Number(await knob.getAttribute('aria-valuenow'));
}

// The panel renders `defaultToasterState` before the audio device finishes
// loading, but the kit store mutators (updateKit) deliberately no-op for an
// unregistered deviceId — a write that races ahead of registration is dropped,
// not queued. A single keyboard nudge can therefore land in that window. Retry
// the nudge until the store round-trip moves the slider; the loop stops at the
// first effective press, so exact single-step arithmetic still holds. Returns
// the settled value for the caller to assert on.
async function nudgeUntil(
    page: import('@playwright/test').Page,
    label: string,
    key: 'ArrowUp' | 'ArrowDown',
    hasMoved: (value: number) => boolean
): Promise<number> {
    const knob = page.getByRole('slider', { name: label });
    await knob.focus();
    for (let attempt = 0; attempt < 5; attempt += 1) {
        await page.keyboard.press(key);
        const deadline = Date.now() + 1500;
        while (Date.now() < deadline) {
            const value = await readSliderValue(page, label);
            if (hasMoved(value)) {
                return value;
            }
            await page.waitForTimeout(100);
        }
    }
    return readSliderValue(page, label);
}

// Toaster's Groove section carries six kit-level knobs (right rail), all routed
// through setToasterKitParam: Swing (swing), Master (masterGain), Space
// (reverbMix), Spray (delayMix), Bits (lofiBits), Dust (lofiMix). The per-pad
// matrix and kit gain/pan are covered elsewhere; these six had no E2E.
//
// Direction is default-dependent (createDefaultKit): swing/delayMix/lofiMix
// start at their minimum (ArrowUp is the only way that moves), masterGain sits
// mid-range at 1, reverbMix starts at 0.15, and lofiBits ships at its max of 16
// (16 = lofi off) so only ArrowDown can move it. Each test pins the starting
// value first so it cannot silently flip direction if a default changes.
test.describe('Toaster Groove kit knobs — keyboard nudge changes value', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openToaster(page);
    });

    test('ArrowUp on the Swing slider raises swing from its zero default', async ({ page }) => {
        const swing = page.getByRole('slider', { name: 'Swing' });
        await expect(swing).toBeVisible({ timeout: 10_000 });
        expect(await readSliderValue(page, 'Swing')).toBe(0);

        const after = await nudgeUntil(page, 'Swing', 'ArrowUp', (value) => value > 0);
        expect(after).toBeGreaterThan(0);
    });

    test('ArrowUp on the Master slider raises masterGain from its unity default', async ({ page }) => {
        const master = page.getByRole('slider', { name: 'Master' });
        await expect(master).toBeVisible({ timeout: 10_000 });
        expect(await readSliderValue(page, 'Master')).toBe(1);

        const after = await nudgeUntil(page, 'Master', 'ArrowUp', (value) => value > 1);
        expect(after).toBeGreaterThan(1);
    });

    test('ArrowUp on the Space slider raises reverbMix from its default', async ({ page }) => {
        const space = page.getByRole('slider', { name: 'Space' });
        await expect(space).toBeVisible({ timeout: 10_000 });
        expect(await readSliderValue(page, 'Space')).toBe(0.15);

        const after = await nudgeUntil(page, 'Space', 'ArrowUp', (value) => value > 0.15);
        expect(after).toBeGreaterThan(0.15);
    });

    test('ArrowUp on the Spray slider raises delayMix from its zero default', async ({ page }) => {
        const spray = page.getByRole('slider', { name: 'Spray' });
        await expect(spray).toBeVisible({ timeout: 10_000 });
        expect(await readSliderValue(page, 'Spray')).toBe(0);

        const after = await nudgeUntil(page, 'Spray', 'ArrowUp', (value) => value > 0);
        expect(after).toBeGreaterThan(0);
    });

    test('ArrowDown on the Bits slider lowers lofiBits from its max default', async ({ page }) => {
        const bits = page.getByRole('slider', { name: 'Bits' });
        await expect(bits).toBeVisible({ timeout: 10_000 });
        // 16 bits = lofi off; the knob sits at its ceiling, so ArrowUp is a no-op.
        expect(await readSliderValue(page, 'Bits')).toBe(16);

        // Step is 1; a single effective ArrowDown moves exactly one step off the max.
        const after = await nudgeUntil(page, 'Bits', 'ArrowDown', (value) => value === 15);
        expect(after).toBe(15);
    });

    test('ArrowUp on the Dust slider raises lofiMix from its zero default', async ({ page }) => {
        const dust = page.getByRole('slider', { name: 'Dust' });
        await expect(dust).toBeVisible({ timeout: 10_000 });
        expect(await readSliderValue(page, 'Dust')).toBe(0);

        const after = await nudgeUntil(page, 'Dust', 'ArrowUp', (value) => value > 0);
        expect(after).toBeGreaterThan(0);
    });
});
