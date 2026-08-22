import { expect, test, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function focusWorkspace(page: Page): Promise<void> {
    await page.locator('#main-content').click();
}

async function addMidiTrack(page: Page): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    const input = page.getByPlaceholder('Type a command...', { exact: true });
    await expect(input).toBeVisible();
    await input.fill('Add MIDI Track');
    await page.getByRole('option', { name: 'Add MIDI Track' }).click();
    const trackList = page.getByRole('grid', { name: /Track list/i }).first();
    await expect(trackList).toBeVisible();
    await expect.poll(() => trackList.getByRole('row').count()).toBeGreaterThan(0);
}

async function stampEligibleGrooveClip(page: Page): Promise<void> {
    await addMidiTrack(page);
    const canvas = page.getByLabel('Timeline editor surface');
    await expect(canvas).toBeVisible();
    await canvas.click({ button: 'right', position: { x: 300, y: 30 } });
    await page.getByRole('menuitem', { name: /Add Clip Here/i }).click();
    await expect(page.getByText(/New midi clip/i).first()).toBeVisible();
    await canvas.dblclick({ position: { x: 300, y: 30 } });
    const pianoRoll = page.getByLabel('Piano roll editor');
    await expect(pianoRoll).toBeVisible();

    const zoom = page.getByTestId('toolbar-zoom').getByRole('slider');
    await expect(zoom).toHaveAttribute('aria-valuenow', '100');
    const paint = page.getByRole('button', { name: 'Toggle paint mode' });
    await expect(paint).not.toHaveAttribute('aria-pressed', 'true');
    await paint.click();
    await expect(paint).toHaveAttribute('aria-pressed', 'true');

    const noteCount = page.getByLabel(/notes? in /i);
    await expect(noteCount).toHaveText('0 notes');
    for (const x of [50, 90, 130]) {
        await pianoRoll.click({ position: { x, y: 130 } });
    }
    await expect(noteCount).toHaveText('3 notes');
    await page.getByRole('button', { name: 'Close bottom dock' }).click();
    await expect(page.getByLabel('Piano roll editor')).toHaveCount(0);
}

async function openYeastPanel(page: Page): Promise<void> {
    const browser = page.getByRole('complementary', { name: 'Browser panel' });
    await expect(browser).toBeVisible();
    await browser.getByRole('button', { name: 'Effects', exact: true }).click();
    await browser.getByRole('button', { name: 'MIDI FX' }).click();
    await browser.getByRole('button', { name: 'Yeast' }).click();
    await expect(page.getByRole('button', { name: 'Close Yeast' })).toBeVisible();
}

async function expandGrooveProcessor(page: Page): Promise<void> {
    await page.getByRole('button', { name: /Build/ }).click();
    await page.getByRole('button', { name: '+ Groove' }).click();
    await page
        .locator('span')
        .filter({ hasText: /^Groove$/ })
        .click();
    await expect(page.getByRole('combobox', { name: 'Groove template' })).toBeVisible();
}

async function grooveTemplateOptions(page: Page): Promise<string[]> {
    return page.getByRole('combobox', { name: 'Groove template' }).locator('option').allTextContents();
}

async function commitExtractedGroove(page: Page): Promise<string> {
    const before = await grooveTemplateOptions(page);

    await page.getByRole('combobox', { name: 'Groove extraction subdivision' }).selectOption('1/8');
    const clipSelect = page.getByRole('combobox', { name: 'MIDI clip for groove extraction' });
    const clipLabel = (await clipSelect.locator('option').allTextContents()).find((text) =>
        /new midi clip/i.test(text)
    );
    if (clipLabel === undefined) {
        throw new Error('Groove extraction clip list has no New midi clip option');
    }
    await clipSelect.selectOption({ label: clipLabel });
    await page.getByRole('button', { name: 'Preview groove' }).click();

    const status = page
        .getByLabel('Extract groove from MIDI clip')
        .locator('xpath=ancestor::div[1]')
        .locator('[role="status"]');
    await expect(status).toHaveText(/Previewing/);
    await page.getByRole('button', { name: 'Save groove' }).click();
    await expect(page.getByRole('button', { name: 'Save groove' })).toHaveCount(0);

    const added = (await grooveTemplateOptions(page)).filter((text) => !before.includes(text));
    expect(added).toHaveLength(1);
    const committedName = added[0];
    if (committedName === undefined) {
        throw new Error('Save groove did not add a template option');
    }
    return committedName;
}

test.describe('Yeast groove assign, rename, delete', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await focusWorkspace(page);
        await stampEligibleGrooveClip(page);
        await openYeastPanel(page);
        await expandGrooveProcessor(page);
    });

    test('assigning a saved template mounts rename, Rename updates the option, Delete restores Straight', async ({
        page,
    }) => {
        const committedName = await commitExtractedGroove(page);
        const combobox = page.getByRole('combobox', { name: 'Groove template' });
        const nameInput = page.getByRole('textbox', { name: 'Groove template name' });

        await expect(combobox).toHaveValue('groove-straight');
        await expect(nameInput).toHaveCount(0);

        await combobox.selectOption({ label: committedName });
        await expect(combobox).not.toHaveValue('groove-straight');
        await expect(nameInput).toHaveValue(committedName);

        await nameInput.fill('Renamed groove');
        await page.getByRole('button', { name: 'Rename', exact: true }).click();
        await expect(page.getByRole('option', { name: 'Renamed groove' })).toHaveCount(1);
        await expect(page.getByRole('option', { name: committedName, exact: true })).toHaveCount(0);
        await expect(nameInput).toHaveValue('Renamed groove');

        await page.getByRole('button', { name: 'Delete template' }).click();
        await expect(page.getByRole('option', { name: 'Renamed groove' })).toHaveCount(0);
        await expect(nameInput).toHaveCount(0);
        await expect(combobox).toHaveValue('groove-straight');
    });
});
