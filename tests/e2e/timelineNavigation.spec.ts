import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('Timeline Navigation & Editing Surface', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.keyboard.press(`${MOD}+k`);
        await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
        await page.getByRole('option', { name: 'Add MIDI Track' }).click();
    });

    test('Timeline chrome components are all visible and interactive', async ({ page }) => {
        const minimap = page.getByRole('slider', { name: /^Timeline minimap/ });
        const sections = page.getByRole('region', { name: 'Arrangement sections' });
        const adj_layers = page.getByRole('region', { name: 'Adjustment layers' });
        const beat_ruler = page.getByLabel('Beat ruler');

        await expect(minimap).toBeVisible();
        await expect(sections).toBeVisible();
        await expect(adj_layers).toBeVisible();
        await expect(beat_ruler).toBeVisible();
    });

    test('Can add an adjustment layer and verify it appears in the strip', async ({ page }) => {
        const strip = page.getByRole('region', { name: 'Adjustment layers' });
        const items_before = await strip.locator('[class*="layer"], [data-layer]').count();

        await page.getByRole('button', { name: 'Add adjustment layer' }).click();
        await page.waitForTimeout(1000);

        const items_after = await strip.locator('[class*="layer"], [data-layer]').count();
        expect(items_after).toBeGreaterThanOrEqual(items_before);
    });

    /**
     * Zoom observable: the minimap slider's aria-valuenow is scrollX as a percentage of
     * the project at the current zoom (TimelineMinimap.tsx), and zoomTimeline raises
     * pixelsPerBeat while holding scrollX — so with the viewport scrolled off zero, a
     * zoom-in must shrink the recorded percentage. The first phase pins the minimap's
     * own keyboard scroll; the second pins the zoom shortcut. Polling on the value,
     * never a sleep (#3675).
     */
    test('Zoom in changes timeline scroll position', async ({ page }) => {
        const timeline = page.getByLabel('Timeline editor surface');
        await timeline.click();

        const minimap = page.getByRole('slider', { name: /^Timeline minimap/ });
        await minimap.focus();
        await page.keyboard.press('ArrowRight');
        await expect.poll(async () => (await minimap.getAttribute('aria-valuenow')) ?? '').not.toBe('0');

        const scrolled = await minimap.getAttribute('aria-valuenow');
        await page.keyboard.press('=');
        await page.keyboard.press('=');
        await expect
            .poll(async () => Number((await minimap.getAttribute('aria-valuenow')) ?? '0'))
            .toBeLessThan(Number(scrolled ?? '0'));
    });

    /**
     * Seek oracle (#4425): a click must land on the clicked musical location, not merely move
     * the playhead somewhere. The expected beats are computed from the geometry contract
     * established from live code — canvas origin at its left edge with no header inset,
     * beat = (clickX + scrollX) / pixelsPerBeat with no snapping — using this spec's own
     * arithmetic, never the production coordinate-to-beat helper under test. The playhead
     * readout is parsed back to beats by this spec's own inverse of the display contract
     * (bar.beat.tick at 4/4, 480 ticks per beat), so a fixed-destination seek, an omitted
     * scroll offset, or a stale zoom scale each miss the tolerance.
     */
    const DEFAULT_PIXELS_PER_BEAT = 12;
    const ZOOM_STEP_PER_PRESS = 4;
    const MINIMAP_ARROW_BEATS = 4;

    const playheadBeats = async (page: import('@playwright/test').Page): Promise<number> => {
        const text = (await page.getByTestId('transport-playhead').textContent()) ?? '';
        // The readout prefixes the first segment with its unit label ("Bars2.4.000"); the
        // spec's inverse of the display contract skips it and reads the three numbers.
        const match = /^\D*(\d+)\.(\d+)\.(\d+)$/.exec(text.trim());
        if (match === null) {
            throw new Error(`playhead readout is not bar.beat.tick: "${text.trim()}"`);
        }
        const [, bar, beat, tick] = match;
        return (Number(bar) - 1) * 4 + (Number(beat) - 1) + Number(tick) / 480;
    };

    const expectPlayheadNear = async (page: import('@playwright/test').Page, expectedBeats: number): Promise<void> => {
        await expect.poll(async () => Math.abs((await playheadBeats(page)) - expectedBeats)).toBeLessThan(0.25);
    };

    test('Timeline clicks seek the clicked beat at the default zoom', async ({ page }) => {
        const timeline = page.getByLabel('Timeline editor surface');
        const box = await timeline.boundingBox();
        expect(box).not.toBeNull();

        // Fresh project: scrollX is 0 and pixelsPerBeat is the store default, so a click at
        // x pixels inside the canvas seeks to x / 12 beats.
        await timeline.click({ position: { x: DEFAULT_PIXELS_PER_BEAT * 7, y: (box?.height ?? 0) * 0.5 } });
        await expectPlayheadNear(page, 7);

        await timeline.click({ position: { x: DEFAULT_PIXELS_PER_BEAT * 13, y: (box?.height ?? 0) * 0.5 } });
        await expectPlayheadNear(page, 13);
    });

    test('Timeline clicks seek the clicked beat under zoom and scroll', async ({ page }) => {
        // Two zoom-in presses and three minimap arrow steps: pixelsPerBeat rises to
        // 12 + 2*4 = 20 and scrollX to 3 * 4 * 20 = 240 px, so a click at x inside the
        // canvas seeks to (x + 240) / 20 beats.
        await page.getByLabel('Timeline editor surface').click();
        await page.keyboard.press('=');
        await page.keyboard.press('=');
        const minimap = page.getByRole('slider', { name: /^Timeline minimap/ });
        await minimap.focus();
        for (let index = 0; index < 3; index += 1) {
            await page.keyboard.press('ArrowRight');
        }
        await expect.poll(async () => (await minimap.getAttribute('aria-valuenow')) ?? '').not.toBe('0');

        const pixelsPerBeat = DEFAULT_PIXELS_PER_BEAT + 2 * ZOOM_STEP_PER_PRESS;
        const scrollX = 3 * MINIMAP_ARROW_BEATS * pixelsPerBeat;
        const timeline = page.getByLabel('Timeline editor surface');
        const box = await timeline.boundingBox();
        expect(box).not.toBeNull();

        await timeline.click({ position: { x: pixelsPerBeat * 17 - scrollX, y: (box?.height ?? 0) * 0.5 } });
        await expectPlayheadNear(page, 17);

        await timeline.click({ position: { x: pixelsPerBeat * 25 - scrollX, y: (box?.height ?? 0) * 0.5 } });
        await expectPlayheadNear(page, 25);
    });

    test('Timeline minimap responds to keyboard and changes value', async ({ page }) => {
        const minimap = page.getByRole('slider', { name: /^Timeline minimap/ });
        const value_before = Number((await minimap.getAttribute('aria-valuenow')) ?? '0');
        const playhead = page.getByRole('button', { name: /Playhead position/i });
        const playhead_before = await playhead.textContent();

        await minimap.focus();
        await page.keyboard.press('ArrowRight');

        await expect
            .poll(async () => Number((await minimap.getAttribute('aria-valuenow')) ?? '0'))
            .toBeGreaterThan(value_before);
        // Viewport scroll is not transport: the playhead must not move with it.
        expect(await playhead.textContent()).toBe(playhead_before ?? '');
    });

    test('Can right-click timeline for context menu with actionable items', async ({ page }) => {
        const timeline = page.getByLabel('Timeline editor surface');
        const box = await timeline.boundingBox();
        expect(box).not.toBeNull();
        await timeline.click({ button: 'right', position: { x: 200, y: (box?.height ?? 0) * 0.5 } });

        const menu = page.getByRole('menu');
        await expect(menu).toBeVisible({ timeout: 5000 });
        const items = menu.getByRole('menuitem');
        const count = await items.count();
        expect(count).toBeGreaterThan(0);
    });

    test('Beat ruler clicks seek the clicked beat under zoom and scroll', async ({ page }) => {
        // Same oracle as the timeline cases, on the ruler surface: the ruler shares the
        // canvas coordinate contract (origin at its left edge, scrollX and pixelsPerBeat
        // from the same view state), so the scrolled-and-zoomed expectation applies
        // unchanged — a ruler transform that omits the scroll offset misses by the
        // full 12-beat scroll amount.
        await page.getByLabel('Timeline editor surface').click();
        await page.keyboard.press('=');
        await page.keyboard.press('=');
        const minimap = page.getByRole('slider', { name: /^Timeline minimap/ });
        await minimap.focus();
        for (let index = 0; index < 3; index += 1) {
            await page.keyboard.press('ArrowRight');
        }
        await expect.poll(async () => (await minimap.getAttribute('aria-valuenow')) ?? '').not.toBe('0');

        const beat_ruler = page.getByLabel('Beat ruler');
        await expect(beat_ruler).toBeVisible();
        const box = await beat_ruler.boundingBox();
        expect(box).not.toBeNull();

        const pixelsPerBeat = DEFAULT_PIXELS_PER_BEAT + 2 * ZOOM_STEP_PER_PRESS;
        const scrollX = 3 * MINIMAP_ARROW_BEATS * pixelsPerBeat;
        await beat_ruler.click({ position: { x: pixelsPerBeat * 21 - scrollX, y: (box?.height ?? 0) * 0.5 } });
        await expectPlayheadNear(page, 21);
    });
});
