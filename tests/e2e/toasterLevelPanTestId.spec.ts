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

// Level and Pan are the last uncovered per-pad knobs (Hit/Tone/Crunch/Bright
// are exercised elsewhere). Level is unipolar (0–1, default 0.8); Pan is
// bipolar (-1–1, default 0). ArrowUp must drive the slider's aria-valuenow up
// for both — confirming the per-pad Level/Pan knobs are wired to the selected
// pad and keyboard-editable, not just present.
test.describe('Toaster per-pad Level & Pan — keyboard edits aria-valuenow', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openToaster(page);
    });

    test('ArrowUp raises the Level knob on pad 0', async ({ page }) => {
        await page.getByTestId('toaster-pad-0').click();

        const levelSlider = page.getByRole('slider', { name: 'Level' });
        await expect(levelSlider).toBeVisible({ timeout: 5000 });
        const before = Number(await levelSlider.getAttribute('aria-valuenow'));

        await levelSlider.focus();
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await levelSlider.getAttribute('aria-valuenow'));

        expect(after).toBeGreaterThan(before);
    });

    test('ArrowUp moves the Pan knob right of center on pad 0', async ({ page }) => {
        await page.getByTestId('toaster-pad-0').click();

        // `exact: true` avoids also matching the kit-level "Toaster Kit pan" slider.
        const panSlider = page.getByRole('slider', { name: 'Pan', exact: true });
        await expect(panSlider).toBeVisible({ timeout: 5000 });
        const before = Number(await panSlider.getAttribute('aria-valuenow'));

        await panSlider.focus();
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const after = Number(await panSlider.getAttribute('aria-valuenow'));

        // Pan is bipolar (-1..1); ArrowUp increments the step toward +1, so the
        // value must increase. A no-op here would mean the knob is not wired.
        expect(after).toBeGreaterThan(before);
    });
});
