import { test, expect } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

/**
 * Opens the Grand Boule piano panel from the Browser panel. Mirrors the opener
 * in grandBoule.spec.ts: the "House Special" Grand Boule card creates its MIDI
 * track + device and mounts the panel in one click; the `Close` control is the
 * panel-mounted contract that the faceplate is up.
 */
async function open_grand_boule_panel(page: import('@playwright/test').Page): Promise<void> {
    const browser = page.getByRole('complementary', { name: 'Browser panel' });
    const grandBouleCard = browser.getByRole('button', { name: 'Grand Boule' });
    await grandBouleCard.waitFor({ state: 'visible' });
    await grandBouleCard.click();

    await expect(page.getByRole('button', { name: 'Close Grand Boule' })).toBeVisible();
}

/**
 * Scopes to the "Radiation" section, which holds the Lid position knob and the
 * Microphone select. Filtering on the section keeps the lid knob lookup isolated
 * from any same-named control elsewhere on the faceplate.
 */
function radiation_section(page: import('@playwright/test').Page) {
    return page.locator('section').filter({ hasText: /Radiation/ });
}

test.describe('Grand Boule — Radiation: Lid position knob', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('keyboard ArrowUp on the Lid position slider raises aria-valuenow', async ({ page }) => {
        await open_grand_boule_panel(page);

        const section = radiation_section(page);
        const lidKnob = section.getByRole('slider', { name: 'Lid position', exact: true });

        // The config default (1.0) is the knob's max — the lid ships fully open,
        // reflected by the readout and the ceiling aria-valuenow.
        await expect(lidKnob).toHaveAttribute('aria-valuenow', '1');
        await expect(section.getByText('100% open')).toBeVisible();

        // The default sits at max, so a single ArrowUp would clamp. Step down a
        // few steps to open headroom below the ceiling, then ArrowUp and confirm
        // the value rises from that lowered baseline.
        await lidKnob.focus();
        for (let i = 0; i < 5; i += 1) {
            await page.keyboard.press('ArrowDown');
        }

        const lowered = Number(await lidKnob.getAttribute('aria-valuenow'));
        expect(lowered).toBeLessThan(1);

        await page.keyboard.press('ArrowUp');

        const raised = Number(await lidKnob.getAttribute('aria-valuenow'));
        expect(raised).toBeGreaterThan(lowered);
    });
});
