import { test, expect, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

async function addMidiTrack(page: Page): Promise<void> {
    const emptyStateMidiButton = page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' });
    await emptyStateMidiButton.waitFor({ state: 'visible' });
    await emptyStateMidiButton.click();
    const trackList = page.getByRole('grid', { name: /Track list/i });
    await trackList.getByRole('row').filter({ hasText: /MIDI/i }).first().waitFor();
}

// Glide — dragging across the on-screen keyboard re-triggers neighbouring
// notes — was completely dead before #1868 (pointer capture retargeted
// boundary events, so no neighbour ever saw pointerenter). It is the core
// playing interaction of the keyboard and has no regression E2E: keys expose
// aria-pressed, so the glide is assertable without any audio surface.
test.describe('Virtual keyboard — mouse glide', () => {
    test('gliding from one key to its neighbour flips both pressed states', async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await addMidiTrack(page);

        await page.getByTestId('toggle-virtual-keyboard').click();
        const keyboard = page.getByRole('application', { name: 'Virtual Piano Keyboard' });
        await expect(keyboard).toBeVisible({ timeout: 10_000 });

        // Scroll the keyboard to its middle so the picked keys sit inside the
        // visible viewport — mouse coordinates hit whatever is on top at
        // those coords, and off-viewport keys are clipped by the scroll
        // container. C4 (MIDI 60) and MIDI 62 are adjacent white keys there.
        await page.evaluate(() => {
            const scroller = document.querySelector('[aria-label="Virtual Piano Keyboard"] .overflow-x-auto');
            if (scroller) {
                scroller.scrollLeft = (scroller.scrollWidth - scroller.clientWidth) / 2;
            }
        });
        const start = keyboard.getByRole('button', { name: 'C4 (MIDI 60)' });
        const end = keyboard.getByRole('button', { name: 'MIDI 62', exact: true });
        await expect(start).toBeVisible();
        await expect(end).toBeVisible();

        // Press on the first key, glide to the second, release. Pointer
        // capture keeps the events on the start key; glide is driven by
        // elementFromPoint hit-testing in the move handler.
        const startBox = await start.boundingBox();
        const endBox = await end.boundingBox();
        expect(startBox).not.toBeNull();
        expect(endBox).not.toBeNull();
        // A click is down+up — the note releases before a poll can see the
        // pressed state; the glide holds the pointer down instead.
        await page.mouse.move(startBox!.x + startBox!.width / 2, startBox!.y + startBox!.height / 2);
        await page.mouse.down();
        await expect(start).toHaveAttribute('aria-pressed', 'true');

        await page.mouse.move(endBox!.x + endBox!.width / 2, endBox!.y + endBox!.height / 2, { steps: 8 });
        await expect(end).toHaveAttribute('aria-pressed', 'true');
        await expect(start).toHaveAttribute('aria-pressed', 'false');

        await page.mouse.up();
        await expect(end).toHaveAttribute('aria-pressed', 'false');
        await expect(start).toHaveAttribute('aria-pressed', 'false');
    });
});
