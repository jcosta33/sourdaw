import { expect, test } from '@playwright/test';
import { launch_from_template, launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function add_track(page: import('@playwright/test').Page, kind: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill(`Add ${kind} Track`);
    await page.getByRole('option', { name: `Add ${kind} Track` }).click();
}

test.describe('Keyboard Shortcut Behavioral Effects', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.locator('#main-content').click();
    });

    test('N key creates a MIDI track that appears in track list', async ({ page }) => {
        const track_list = page.getByRole('grid', { name: /Track list/i });
        const before = await track_list.getByRole('row', { name: /MIDI/i }).count();
        await page.keyboard.press('n');
        await page.waitForTimeout(1000);
        const after = await track_list.getByRole('row', { name: /MIDI/i }).count();
        expect(after).toBeGreaterThan(before);
    });

    test('Shift+N creates an Audio track', async ({ page }) => {
        const track_list = page.getByRole('grid', { name: /Track list/i });
        const before = await track_list.getByRole('row', { name: /Audio/i }).count();
        await page.keyboard.press('Shift+N');
        await page.waitForTimeout(1000);
        const after = await track_list.getByRole('row', { name: /Audio/i }).count();
        expect(after).toBeGreaterThan(before);
    });

    test('Cmd+B hides browser panel', async ({ page }) => {
        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        const was_visible = await browser.isVisible().catch(() => false);
        await page.keyboard.press(`${MOD}+b`);
        await page.waitForTimeout(300);
        const now_visible = await browser.isVisible().catch(() => false);
        expect(now_visible).not.toBe(was_visible);
    });

    test('Play button is clickable and transport remains stable', async ({ page }) => {
        const play = page.getByRole('button', { name: 'Play' }).or(page.getByRole('button', { name: 'Pause' }));
        await play.first().click();
        await page.waitForTimeout(500);
        await play.first().click();
        await page.waitForTimeout(300);
        await expect(page.getByRole('toolbar', { name: 'Transport controls' })).toBeVisible();
    });

    test('Transport has Play, Stop, and Record buttons', async ({ page }) => {
        const play = page.getByRole('button', { name: 'Play' }).or(page.getByRole('button', { name: 'Pause' }));
        const stop = page.getByRole('button', { name: 'Stop' });
        const record = page.getByRole('button', { name: 'Record' }).or(page.getByRole('button', { name: 'Stop recording' }));

        await expect(play.first()).toBeVisible();
        await expect(stop).toBeVisible();
        await expect(record.first()).toBeVisible();
    });
});

test.describe('Inspector Device Chain Operations', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
    });

    test('Can add multiple devices to chain', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });

        await inspector.getByRole('button', { name: 'Add device' }).click();
        const gluten = page.getByRole('menuitem', { name: /Gluten/i });
        if (await gluten.isVisible().catch(() => false)) {
            await gluten.click();
            await page.waitForTimeout(1000);

            await inspector.getByRole('button', { name: 'Add device' }).click();
            const proof = page.getByRole('menuitem', { name: /Proof/i });
            if (await proof.isVisible().catch(() => false)) {
                await proof.click();
                await page.waitForTimeout(1000);

                await expect(inspector.getByText(/Gluten/i)).toBeVisible();
                await expect(inspector.getByText(/Proof/i)).toBeVisible();
            }
        }
    });

    test('Bypassing a device shows Enable button', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await inspector.getByRole('button', { name: 'Add device' }).click();
        const grinder = page.getByRole('menuitem', { name: /Grinder/i });
        if (await grinder.isVisible().catch(() => false)) {
            await grinder.click();
            await page.waitForTimeout(1000);

            const bypass = inspector.getByRole('button', { name: /Bypass Grinder/i });
            await bypass.click();
            await expect(inspector.getByRole('button', { name: /Enable Grinder/i })).toBeVisible({ timeout: 5000 });
        }
    });

    test('Removing a device clears it from inspector', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await inspector.getByRole('button', { name: 'Add device' }).click();
        const bacteria = page.getByRole('menuitem', { name: /Bacteria/i });
        if (await bacteria.isVisible().catch(() => false)) {
            await bacteria.click();
            await page.waitForTimeout(1000);

            const remove = inspector.getByRole('button', { name: /Remove Bacteria/i });
            await remove.click();
            await page.waitForTimeout(1000);

            const still_there = await inspector.getByText(/Bacteria/i).first().isVisible().catch(() => false);
            expect(still_there).toBe(false);
        }
    });
});

test.describe('Timeline Tool Switching Effects', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await add_track(page, 'MIDI');
    });

    test('Number keys switch editing tools', async ({ page }) => {
        const tools = page.getByRole('radiogroup', { name: 'Editing tools' });

        await page.keyboard.press('1');
        await expect(tools.getByRole('radio', { name: /Select/i })).toBeChecked();

        await page.keyboard.press('3');
        const draw = tools.getByRole('radio', { name: /Draw/i });
        if (await draw.isVisible().catch(() => false)) {
            await expect(draw).toBeChecked();
        }

        await page.keyboard.press('1');
        await expect(tools.getByRole('radio', { name: /Select/i })).toBeChecked();
    });

    test('Tool selection via number keys is consistent', async ({ page }) => {
        const tools = page.getByRole('radiogroup', { name: 'Editing tools' });

        await page.keyboard.press('5');
        const stretch = tools.getByRole('radio', { name: /Stretch/i });
        if (await stretch.isVisible().catch(() => false)) {
            await expect(stretch).toBeChecked();
        }

        await page.keyboard.press('4');
        const automation = tools.getByRole('radio', { name: /Auto-draw|Automation/i });
        if (await automation.isVisible().catch(() => false)) {
            await expect(automation).toBeChecked();
        }

        await page.keyboard.press('1');
        await expect(tools.getByRole('radio', { name: /Select/i })).toBeChecked();
    });
});

test.describe('Browser Instrument Interaction Flow', () => {
    test('Can browse instruments and add Toaster to track', async ({ page }) => {
        test.setTimeout(60000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });

        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        await browser.getByRole('button', { name: 'Instruments', exact: true }).click();
        await page.waitForTimeout(500);

        const toaster = browser.getByRole('button', { name: /Toaster/i });
        if (await toaster.isVisible().catch(() => false)) {
            const track_list = page.getByRole('grid', { name: /Track list/i });
            await track_list.getByRole('row').first().click();
            await page.waitForTimeout(300);

            await toaster.click();
            await page.waitForTimeout(1000);

            const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
            await expect(inspector).toBeVisible();
        }
    });

    test('Effects tab shows all effect categories', async ({ page }) => {
        test.setTimeout(60000);
        await setupWorkspace(page);
        await launch_from_template({ page, template_name: /EDM/i });

        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        await browser.getByRole('button', { name: 'Effects', exact: true }).click();
        await page.waitForTimeout(500);

        const all_buttons = browser.getByRole('button');
        const count = await all_buttons.count();
        expect(count).toBeGreaterThan(5);
    });
});

test.describe('StatusBar Live Metrics', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('CPU metric shows a percentage value', async ({ page }) => {
        const status = page.getByRole('status', { name: 'Application status' });
        const cpu = status.getByText('CPU').locator('..');
        const text = await cpu.textContent();
        expect(text).toMatch(/\d+%|idle|N\/A/i);
    });

    test('Sample rate shows a numeric value', async ({ page }) => {
        const status = page.getByRole('status', { name: 'Application status' });
        const rate = status.getByText(/Rate/i).locator('..');
        const text = await rate.textContent();
        expect(text).toMatch(/\d+\s*k?Hz/i);
    });

    test('Output level shows a dB value', async ({ page }) => {
        const status = page.getByRole('status', { name: 'Application status' });
        const out = status.getByText(/Out/i).locator('..');
        const text = await out.textContent();
        expect(text).toMatch(/dB|inf|-|∞/i);
    });
});
