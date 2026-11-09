import { test, expect } from './e2eTest';
import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('Crust metering layout', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.keyboard.press(`${MOD}+k`);
        await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
        await page.getByRole('option', { name: 'Add MIDI Track' }).click();

        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await inspector.getByRole('button', { name: 'Add device' }).click();
        await page.getByRole('menuitem', { name: /^Crust$/ }).click();
        await expect(inspector.getByRole('button', { name: /^Bypass Crust$/i })).toBeVisible();
        await inspector.getByText('Crust', { exact: false }).first().click();
    });

    test('keeps the widest integrated target readout inside its card', async ({ page }) => {
        const targetButton = page
            .locator('button[aria-haspopup="listbox"]')
            .filter({ hasText: /Target/i })
            .first();
        await expect(targetButton).toBeVisible();
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
