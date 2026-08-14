import { test, expect, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

/**
 * Covers the four Grand Boule knobs not exercised by grandBoule.spec.ts:
 * Board (soundboard send), Symp (sympathetic send), Lid position
 * (Radiation), and Sustain (Pedals). Each test asserts the store-default
 * `aria-valuenow`, drives one keystroke in the direction that can move,
 * then asserts both the knob value and the percentage readout changed.
 */
async function open_grand_boule_panel(page: Page): Promise<void> {
    const browser = page.getByRole('complementary', { name: 'Browser panel' });
    const grandBouleCard = browser.getByRole('button', { name: 'Grand Boule' });
    await grandBouleCard.waitFor({ state: 'visible' });
    await grandBouleCard.click();

    await expect(page.getByRole('button', { name: 'Close Grand Boule' })).toBeVisible();
}

/**
 * Section scoping mirrors grandBoule.spec.ts: filtering `section` elements
 * keeps assertions off cross-section text (e.g. the bare "Sustain" word in
 * other cards) while staying inside the faceplate's section cards. The
 * `has:` filter targets the exact section title element — a `hasText`
 * regex would miss because the rendered title is CSS-uppercased ("MIX"),
 * and a substring `hasText` would over-match cross-section prose.
 */
function mix_section(page: Page) {
    return page.locator('section').filter({ has: page.getByText('Mix', { exact: true }) });
}

function radiation_section(page: Page) {
    return page.locator('section').filter({ has: page.getByText('Radiation', { exact: true }) });
}

function pedals_section(page: Page) {
    return page.locator('section').filter({ has: page.getByText('Pedals', { exact: true }) });
}

test.describe('Grand Boule remaining knobs (Board, Symp, Lid position, Sustain)', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('Board soundboard-send knob steps up from its 0.6 default and moves the readout', async ({
        page,
    }) => {
        await open_grand_boule_panel(page);

        const mixSection = mix_section(page);
        const boardKnob = mixSection.getByRole('slider', { name: 'Board', exact: true });
        await expect(boardKnob).toHaveAttribute('aria-valuenow', '0.6');
        await expect(mixSection.getByText('60%', { exact: true })).toBeVisible();

        await boardKnob.focus();
        await page.keyboard.press('ArrowUp');

        await expect(boardKnob).toHaveAttribute('aria-valuenow', '0.61');
        await expect(mixSection.getByText('61%', { exact: true })).toBeVisible();
    });

    test('Symp sympathetic-send knob steps up from its 0.25 default and moves the readout', async ({
        page,
    }) => {
        await open_grand_boule_panel(page);

        const mixSection = mix_section(page);
        const sympKnob = mixSection.getByRole('slider', { name: 'Symp', exact: true });
        await expect(sympKnob).toHaveAttribute('aria-valuenow', '0.25');
        await expect(mixSection.getByText('25%', { exact: true })).toBeVisible();

        await sympKnob.focus();
        await page.keyboard.press('ArrowUp');

        await expect(sympKnob).toHaveAttribute('aria-valuenow', '0.26');
        await expect(mixSection.getByText('26%', { exact: true })).toBeVisible();
    });

    test('Lid position knob steps down from its fully-open default and moves the readout', async ({
        page,
    }) => {
        await open_grand_boule_panel(page);

        const radiationSection = radiation_section(page);
        const lidKnob = radiationSection.getByRole('slider', { name: 'Lid position', exact: true });
        await expect(lidKnob).toHaveAttribute('aria-valuenow', '1');
        await expect(radiationSection.getByText('100% open', { exact: true })).toBeVisible();

        // The default sits at the maximum, so only ArrowDown can move it.
        await lidKnob.focus();
        await page.keyboard.press('ArrowDown');

        await expect(lidKnob).toHaveAttribute('aria-valuenow', '0.99');
        await expect(radiationSection.getByText('99% open', { exact: true })).toBeVisible();
    });

    test('Sustain pedal knob steps up from its 0 default and moves the readout', async ({ page }) => {
        await open_grand_boule_panel(page);

        const pedalsSection = pedals_section(page);
        const sustainKnob = pedalsSection.getByRole('slider', { name: 'Sustain', exact: true });
        await expect(sustainKnob).toHaveAttribute('aria-valuenow', '0');
        await expect(pedalsSection.getByText('0%', { exact: true })).toBeVisible();

        await sustainKnob.focus();
        await page.keyboard.press('ArrowUp');

        await expect(sustainKnob).toHaveAttribute('aria-valuenow', '0.01');
        await expect(pedalsSection.getByText('1%', { exact: true })).toBeVisible();
    });
});
