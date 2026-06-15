import { test, expect } from '@playwright/test';

import { setupWorkspace } from './e2eUtils';

test.describe('Device Panels & Inspector', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);

        // Load the empty project
        const launchScreen = page.getByLabel('Sourdaw — start a project');
        await launchScreen.waitFor({ state: 'visible' });
        await page.locator('#launch-new-project').click();
        
        // Wait for the workspace to initialize
        await expect(page.getByText('Baking')).toBeVisible({ timeout: 5000 });
        await expect(page.getByRole('group', { name: 'Playback controls' })).toBeVisible();
    });

    test('Can expand a chain device into its panel and interact with a core parameter', async ({ page }) => {
        // Add a new Audio track so the inspector device chain is available.
        const addAudioButton = page
            .locator('button')
            .filter({ hasText: 'Audio' })
            .filter({ hasText: 'Record or import' });
        await addAudioButton.waitFor({ state: 'visible' });
        await addAudioButton.click();

        // Insert a Grinder (effect with a custom expanded panel) into the track chain.
        const addDeviceButton = page.getByLabel('Add device');
        await expect(addDeviceButton).toBeVisible();
        await addDeviceButton.click();

        const grinderItem = page.getByRole('menuitem', { name: /Grinder/i });
        await grinderItem.waitFor({ state: 'visible' });
        await grinderItem.click();

        // The device card lands in the chain — its bypass control proves it exists.
        const grinderBypass = page.getByRole('button', { name: 'Bypass Grinder' });
        await expect(grinderBypass).toBeVisible();

        // Double-click the device card to open its expanded panel. The card opens
        // on click; a double-click fires the same handler, matching how a user
        // expands a device from the chain.
        const grinderCard = page.getByText('Grinder', { exact: true });
        await grinderCard.dblclick();

        // The expanded panel mounts inside InstrumentBottomPanel, which exposes a
        // "Close Grinder" control — a stable hook that the panel is open.
        const closePanel = page.getByRole('button', { name: 'Close Grinder' });
        await expect(closePanel).toBeVisible();

        // Interact with a core parameter of the expanded panel: switch to the Amp
        // section and confirm its labelled knobs render.
        const ampTab = page.getByRole('button', { name: 'Amp', exact: true });
        await expect(ampTab).toBeVisible();
        await ampTab.click();

        // The Amp section surfaces the tone-stack response readout.
        await expect(page.getByLabel('Tone stack response')).toBeVisible();

        // The preset search box is a labelled core control of the panel — drive it
        // and assert the value round-trips through React state.
        const presetSearch = page.getByLabel('Search Grinder presets');
        await expect(presetSearch).toBeVisible();
        await presetSearch.fill('clean');
        await expect(presetSearch).toHaveValue('clean');

        // Close the panel and confirm it tears down.
        await closePanel.click();
        await expect(closePanel).not.toBeVisible();
    });

    test('Can toggle the Inspector panel', async ({ page }) => {
        // Add a new Audio track to populate the inspector
        const addAudioButton = page.locator('button').filter({ hasText: 'Audio' }).filter({ hasText: 'Record or import' });
        await addAudioButton.waitFor({ state: 'visible' });
        await addAudioButton.click();

        // The inspector button might be disabled or have different states if no track is selected,
        // but creating a track usually selects it automatically.
        const inspectorToggle = page.getByRole('button', { name: 'Toggle inspector' });
        await expect(inspectorToggle).toBeVisible();

        // Ensure it's not open by default (if the workspace starts with it closed)
        const isPressed = await inspectorToggle.getAttribute('aria-pressed');
        if (isPressed !== 'true') {
            await inspectorToggle.click();
        }

        // Verify the Inspector surface opens
        const inspectorPanel = page.getByLabel('Inspector panel');
        await expect(inspectorPanel).toBeVisible();

        // Check for basic track inspector elements
        const colorLabel = inspectorPanel.getByText('Color', { exact: true }).first();
        await expect(colorLabel).toBeVisible();

        // Close the panel
        await inspectorToggle.click();
        await expect(inspectorPanel).not.toBeVisible();
    });
});
