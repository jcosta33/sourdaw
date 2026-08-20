import { expect, test, type Locator, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function addMidiTrack(page: Page): Promise<void> {
    const trackList = page.getByRole('grid', { name: /Track list/i }).first();
    const before = await trackList.getByRole('row').count();
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
    await page.getByRole('option', { name: 'Add MIDI Track' }).click();
    await expect.poll(() => trackList.getByRole('row').count()).toBeGreaterThan(before);
    await trackList
        .getByRole('row')
        .filter({ has: page.getByText('MIDI', { exact: true }) })
        .first()
        .click();
}

function inspector(page: Page) {
    return page.getByRole('complementary', { name: 'Inspector panel' });
}

async function openGlutenThreshold(page: Page): Promise<Locator> {
    const panel = inspector(page);
    await panel.getByRole('button', { name: 'Add device' }).click();
    await page.getByRole('menuitem', { name: /^Gluten$/ }).click();
    await expect(panel.getByRole('button', { name: /^Bypass Gluten$/i })).toBeVisible();

    await panel
        .locator('[data-testid^="device-card-"]')
        .filter({ has: page.getByText('Gluten', { exact: true }) })
        .click();

    const knob = page.getByRole('slider', { name: 'Threshold' });
    await expect(knob).toBeVisible();
    return knob;
}

async function numericAttribute(knob: Locator, name: string): Promise<number> {
    const raw = await knob.getAttribute(name);
    if (raw === null || raw === '') {
        throw new Error(`${name} is missing`);
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) {
        throw new Error(`${name} is not a finite number: ${raw}`);
    }
    return value;
}

async function valueNow(knob: Locator): Promise<number> {
    return numericAttribute(knob, 'aria-valuenow');
}

test.describe('Device parameter knob — keyboard increment (Gluten)', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await addMidiTrack(page);
    });

    test('ArrowUp increments aria-valuenow', async ({ page }) => {
        const knob = await openGlutenThreshold(page);
        await knob.focus();
        const before = await valueNow(knob);

        await page.keyboard.press('ArrowUp');

        await expect.poll(() => valueNow(knob)).toBeGreaterThan(before);
    });

    test('ArrowDown decrements aria-valuenow', async ({ page }) => {
        const knob = await openGlutenThreshold(page);
        await knob.focus();
        const before = await valueNow(knob);

        await page.keyboard.press('ArrowUp');
        await expect.poll(() => valueNow(knob)).toBeGreaterThan(before);
        const raised = await valueNow(knob);

        await page.keyboard.press('ArrowDown');

        await expect.poll(() => valueNow(knob)).toBeLessThan(raised);
    });

    test('Home sets the knob to its minimum', async ({ page }) => {
        const knob = await openGlutenThreshold(page);
        const min = await numericAttribute(knob, 'aria-valuemin');
        const max = await numericAttribute(knob, 'aria-valuemax');
        expect(min).not.toBe(max);
        await knob.focus();

        await page.keyboard.press('End');
        await expect.poll(() => valueNow(knob)).toBe(max);

        await page.keyboard.press('Home');

        await expect.poll(() => valueNow(knob)).toBe(min);
    });

    test('End sets the knob to its maximum', async ({ page }) => {
        const knob = await openGlutenThreshold(page);
        const min = await numericAttribute(knob, 'aria-valuemin');
        const max = await numericAttribute(knob, 'aria-valuemax');
        expect(min).not.toBe(max);
        await knob.focus();

        await page.keyboard.press('Home');
        await expect.poll(() => valueNow(knob)).toBe(min);

        await page.keyboard.press('End');

        await expect.poll(() => valueNow(knob)).toBe(max);
    });
});
