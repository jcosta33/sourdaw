import { expect, test } from '@playwright/test';
import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('Inspector — Track Properties', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.keyboard.press(`${MOD}+k`);
        await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
        await page.getByRole('option', { name: 'Add MIDI Track' }).click();
    });

    test('Inspector shows track properties with interactive controls for selected track', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await expect(inspector).toBeVisible();
        await expect(inspector.getByText('Kind:')).toBeVisible();
        await expect(inspector.getByText('Color')).toBeVisible();
        await expect(inspector.getByText('Level')).toBeVisible();
        await expect(inspector.getByText('Devices')).toBeVisible();
        const color_buttons = inspector.getByRole('button', { name: /Set color/i });
        const color_count = await color_buttons.count();
        expect(color_count).toBeGreaterThan(0);
    });

    test('Can toggle track arm from track header', async ({ page }) => {
        const track_list = page.getByRole('grid', { name: /Track list/i });
        await track_list.getByRole('button', { name: /^Arm / }).click();
        await expect(track_list.getByRole('button', { name: /^Disarm/ })).toBeVisible({ timeout: 5000 });
    });

    test('Can toggle track mute from track header', async ({ page }) => {
        const track_list = page.getByRole('grid', { name: /Track list/i });
        await track_list.getByRole('button', { name: /^Mute / }).click();
        await expect(track_list.getByRole('button', { name: /^Unmute/ })).toBeVisible({ timeout: 5000 });
    });

    test('Can toggle track solo from track header', async ({ page }) => {
        const track_list = page.getByRole('grid', { name: /Track list/i });
        await track_list.getByRole('button', { name: /^Solo / }).click();
        await expect(track_list.getByRole('button', { name: /^Unsolo/ })).toBeVisible({ timeout: 5000 });
    });

    test('Track gain slider has a numeric value and is interactive', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const gain = inspector.getByRole('slider', { name: /gain/i });
        await expect(gain).toBeVisible();
        const value = await gain.getAttribute('aria-valuenow');
        expect(value).not.toBeNull();
    });

    test('Can add a device to the track chain', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await inspector.getByRole('button', { name: 'Add device' }).click();

        const grinder = page.getByRole('menuitem', { name: /Grinder/i });
        await expect(grinder).toBeVisible({ timeout: 5000 });
        await grinder.click();

        await expect(inspector.getByText(/Grinder/i)).toBeVisible({ timeout: 5000 });
    });

    test('Can write notes for the track', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const notes = inspector.getByRole('textbox', { name: /Notes/i });
        await notes.fill('Test notes for this track');
        await expect(notes).toHaveValue('Test notes for this track');
    });

    test('Can create a VCA group', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await inspector.getByRole('button', { name: /Create VCA group/i }).click();
        const vca_select = inspector.getByRole('combobox', { name: 'VCA group' });
        await expect(vca_select).toBeVisible();
    });

    test('Can add an automation lane', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await inspector.getByRole('button', { name: /Add automation lane/i }).click();

        const menu = page.getByRole('menu');
        await expect(menu).toBeVisible({ timeout: 5000 });
        const items = menu.getByRole('menuitem');
        expect(await items.count()).toBeGreaterThan(0);
    });

    test('Can toggle Follow Chord Track', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const follow = inspector.getByRole('checkbox', { name: /Follow chord track/i });
        await expect(follow).not.toBeChecked();
        await follow.click();
        await expect(follow).toBeChecked();
    });

    test('Can close and reopen the inspector', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await expect(inspector).toBeVisible();

        await page.keyboard.press(`${MOD}+i`);
        await expect(inspector).toBeHidden();

        await page.keyboard.press(`${MOD}+i`);
        await expect(inspector).toBeVisible();
    });
});
