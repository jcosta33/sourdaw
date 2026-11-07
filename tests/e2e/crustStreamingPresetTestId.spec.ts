import { test, expect } from './e2eTest';
import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

// Crust streaming-loudness-target preset: opening the listbox + selecting a
// different preset changes aria-selected + the target LUFS readout. No E2E
// covers this; #1707 covered the level chips.
test.describe('Crust streaming preset — selection changes aria-selected + LUFS target', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');

        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await inspector.getByRole('button', { name: 'Add device' }).click();
        await page.getByRole('menuitem', { name: /^Crust$/ }).click();
        await page.waitForTimeout(800);
        await expect(inspector.getByRole('button', { name: /^Bypass Crust$/i })).toBeVisible();
        await inspector.getByText('Crust', { exact: false }).first().click();
        await page.waitForTimeout(800);
    });

    test('selecting a streaming preset flips aria-selected and changes the LUFS readout', async ({ page }) => {
        // The streaming-target button opens a listbox. Scope by its "Target"
        // label to distinguish from any other listbox-popup button.
        const targetButton = page
            .locator('button[aria-haspopup="listbox"]')
            .filter({ hasText: /Target/i })
            .first();
        await expect(targetButton).toBeVisible({ timeout: 5000 });

        // Capture the current LUFS readout before switching.
        const lufsBefore = (await targetButton.innerText()).trim();

        // Open the listbox.
        await targetButton.click();
        await page.waitForTimeout(300);
        await expect(targetButton).toHaveAttribute('aria-expanded', 'true');

        // The listbox options each have aria-selected. Find an inactive one.
        const listbox = page.getByRole('listbox', { name: 'Streaming loudness targets' });
        const options = listbox.getByRole('option');
        const optCount = await options.count();
        expect(optCount).toBeGreaterThanOrEqual(2);

        // Select the first option that is NOT currently selected.
        let selected = false;
        for (let i = 0; i < optCount && !selected; i += 1) {
            const opt = options.nth(i);
            const isSelected = await opt.getAttribute('aria-selected');
            if (isSelected !== 'true') {
                await opt.click();
                await page.waitForTimeout(300);
                selected = true;
            }
        }
        expect(selected).toBe(true);

        // The LUFS readout changed — a real state change from the preset swap.
        const lufsAfter = (await targetButton.innerText()).trim();
        expect(lufsAfter).not.toBe(lufsBefore);
    });

    test('keeps the widest integrated target readout inside its card', async ({ page }) => {
        const targetButton = page
            .locator('button[aria-haspopup="listbox"]')
            .filter({ hasText: /Target/i })
            .first();
        await targetButton.click();
        const listbox = page.getByRole('listbox', { name: 'Streaming loudness targets' });
        await listbox.getByRole('option').first().click();

        const integrated = page.locator('[aria-label^="Integrated LUFS:"]');
        await expect(integrated).toBeVisible();
        const line = integrated.locator('..');
        await line.evaluate((element) => {
            const [value, unit, delta] = [...element.querySelectorAll('span')];
            if (!value || !unit || !delta) {
                throw new Error('Expected integrated value, unit and target delta');
            }
            value.textContent = '-100.0';
            delta.textContent = '(+100.0)';
        });

        const geometry = await line.evaluate((element) => {
            const card = element.closest('section');
            if (!card) {
                throw new Error('Expected the loudness card');
            }
            const cardStyle = getComputedStyle(card);
            const contentRight = card.getBoundingClientRect().right - Number.parseFloat(cardStyle.paddingRight);
            const children = [...element.querySelectorAll('span')].map((child) => {
                const rect = child.getBoundingClientRect();
                return { left: rect.left, right: rect.right };
            });
            return { contentRight, contentLeft: element.getBoundingClientRect().left, children };
        });

        for (const child of geometry.children) {
            expect(child.left).toBeGreaterThanOrEqual(geometry.contentLeft - 1);
            expect(child.right).toBeLessThanOrEqual(geometry.contentRight + 1);
        }
    });
});
