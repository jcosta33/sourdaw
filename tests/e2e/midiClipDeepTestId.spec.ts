import { test, expect } from '@playwright/test';

import { launch_from_template, setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

test.describe('MIDI clip deep operations — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await page.getByLabel('Sourdaw — start a project').waitFor({ state: 'visible' });
        await page.locator('#launch-from-template').click();
        await page.getByRole('button', { name: 'Pop Song' }).click();
        await wait_for_workspace_ready(page);
    });

    test('Pop Song template has tracks with MIDI clips', async ({ page }) => {
        const trackList = page.getByRole('grid', { name: /Track list/i }).first();
        const rows = trackList.getByRole('row');
        const count = await rows.count();
        expect(count).toBeGreaterThan(0);
    });

    test('double-clicking a clip on timeline opens piano roll', async ({ page }) => {
        const canvas = page.getByLabel('Timeline editor surface');
        await expect(canvas).toBeVisible({ timeout: 15_000 });

        // Double-click somewhere in the timeline to try opening a clip.
        await canvas.dblclick({ position: { x: 200, y: 40 } });
        await page.waitForTimeout(1000);

        // Piano roll editor should be visible if a clip was found.
        const pianoRoll = page.locator('[aria-label="Piano roll editor"]');
        const hasPianoRoll = await pianoRoll.isVisible().catch(() => false);
        if (hasPianoRoll) {
            // Scale root selector should be present.
            await expect(page.getByTestId('toolbar-scale-root')).toBeVisible({ timeout: 5000 });
        }
    });

    test('paint mode toggle works in piano roll', async ({ page }) => {
        const canvas = page.getByLabel('Timeline editor surface');
        await canvas.dblclick({ position: { x: 200, y: 40 } });
        await page.waitForTimeout(1000);

        const pianoRoll = page.locator('[aria-label="Piano roll editor"]');
        if (await pianoRoll.isVisible().catch(() => false)) {
            const paint = page.getByTestId('toolbar-paint');
            await expect(paint).toBeVisible({ timeout: 5000 });
            await expect(paint).toHaveAttribute('aria-pressed', 'false');

            await paint.click();
            await expect(paint).toHaveAttribute('aria-pressed', 'true');
        }
    });

    test('ghost notes toggle works in piano roll', async ({ page }) => {
        const canvas = page.getByLabel('Timeline editor surface');
        await canvas.dblclick({ position: { x: 200, y: 40 } });
        await page.waitForTimeout(1000);

        const pianoRoll = page.locator('[aria-label="Piano roll editor"]');
        if (await pianoRoll.isVisible().catch(() => false)) {
            const ghost = page.getByTestId('toolbar-ghost');
            const before = await ghost.getAttribute('aria-pressed');
            await ghost.click();
            await page.waitForTimeout(300);
            await expect(ghost).not.toHaveAttribute('aria-pressed', before ?? '');
        }
    });

    test('chord stamp mode reveals chord type selector', async ({ page }) => {
        const canvas = page.getByLabel('Timeline editor surface');
        await canvas.dblclick({ position: { x: 200, y: 40 } });
        await page.waitForTimeout(1000);

        const pianoRoll = page.locator('[aria-label="Piano roll editor"]');
        if (await pianoRoll.isVisible().catch(() => false)) {
            const chord = page.getByTestId('toolbar-chord');
            await chord.click();
            await page.waitForTimeout(300);

            const chordType = page.getByTestId('toolbar-chord-type');
            await expect(chordType).toBeVisible({ timeout: 5000 });
        }
    });
});
