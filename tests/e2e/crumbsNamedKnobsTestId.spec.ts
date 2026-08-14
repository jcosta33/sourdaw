import { test, expect, type Locator, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function openCrumbs(page: Page): Promise<void> {
    const search = page.getByTestId('browser-search');
    if (!(await search.isVisible().catch(() => false))) {
        await page.getByTestId('toggle-browser').click();
        await page.waitForTimeout(500);
    }
    await search.fill('crumbs');
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /^Crumbs/i }).first().click();
    // The Crumbs device mounts in the bottom panel labelled "Sampler"
    // (AppShell wires CrumbsPanel into InstrumentBottomPanel label="Sampler"),
    // so the panel-mounted contract is the "Close Sampler" button.
    await expect(page.getByRole('button', { name: 'Close Sampler' })).toBeVisible({ timeout: 15_000 });
}

// The named parameter knobs live in the Sampler device panel; scoping to the
// panel subtree keeps the locator clear of any same-named slider elsewhere in
// the workspace (e.g. transport or mixer surfaces).
function panelKnob(page: Page, label: string): Locator {
    const closeBtn = page.getByRole('button', { name: 'Close Sampler' });
    return closeBtn
        .locator('xpath=ancestor::div[3]')
        .getByRole('slider', { name: label, exact: true });
}

// Focus the knob, press the arrow key, and assert the committed value moved to
// the quantized next step. Expected values are deterministic: RotaryKnob's
// keyboard handler quantizes to `min + n*step` with toPrecision(15), so one
// ArrowUp/ArrowDown from the descriptor default lands on an exact attribute
// string.
async function assertKnobStepsTo(page: Page, label: string, key: 'ArrowUp' | 'ArrowDown', expected: string): Promise<void> {
    const knob = panelKnob(page, label);
    await expect(knob).toBeVisible({ timeout: 10_000 });

    const before = await knob.getAttribute('aria-valuenow');
    expect(before, `${label} should expose aria-valuenow before the keypress`).not.toBeNull();

    await knob.focus();
    await page.keyboard.press(key);

    await expect(knob).toHaveAttribute('aria-valuenow', expected);
    expect(before, `${label} aria-valuenow should have changed`).not.toBe(expected);
}

test.describe('Crumbs sampler panel — named knobs', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openCrumbs(page);
    });

    test('Atk knob increases from its minimum default on ArrowUp', async ({ page }) => {
        // Attack default 0.001s is also its minimum, so the only way is up:
        // one 0.001 step lands on 0.002.
        await assertKnobStepsTo(page, 'Atk', 'ArrowUp', '0.002');
    });

    test('Cutoff knob decreases from its maximum default on ArrowDown', async ({ page }) => {
        // Filter cutoff default 20000Hz is its maximum, so ArrowUp is a no-op
        // there; one 10Hz step down lands on 19990.
        await assertKnobStepsTo(page, 'Cutoff', 'ArrowDown', '19990');
    });

    test('Gain knob increases one 0.01 step on ArrowUp', async ({ page }) => {
        // Master gain default 0.8; one step up is 0.81.
        await assertKnobStepsTo(page, 'Gain', 'ArrowUp', '0.81');
    });

    test('Pan knob moves off centre one 0.01 step on ArrowUp', async ({ page }) => {
        // Pan default 0 (centre); one step up is 0.01 (right of centre).
        await assertKnobStepsTo(page, 'Pan', 'ArrowUp', '0.01');
    });
});
