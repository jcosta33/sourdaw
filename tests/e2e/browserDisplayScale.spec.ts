import { expect, test, type Frame, type FrameLocator, type Locator, type Page } from '@playwright/test';
import { stringify as superjsonStringify } from 'superjson';

import { LAUNCH_SCREEN_FIRST_PAINT_TIMEOUT_MS } from './e2eUtils';

type Box = { x: number; y: number; width: number; height: number };
type RecentProject = { key: string; name: string; updatedAt: number };

const VIEWPORT = { width: 1280, height: 720 };
const RECENT_PROJECTS: RecentProject[] = Array.from({ length: 10 }, (_, index) => ({
    key: `recent-project-${String(index + 1)}`,
    name: `Recent Project ${String(index + 1)}`,
    updatedAt: Date.now() - index * 60_000,
}));

function requireBox(box: Box | null, label: string): Box {
    if (box === null) {
        throw new Error(`${label} has no rendered bounding box`);
    }
    return box;
}

function expectInsideViewport(box: Box): void {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(VIEWPORT.width);
    expect(box.y + box.height).toBeLessThanOrEqual(VIEWPORT.height);
}

async function findApplicationFrame(page: Page): Promise<Frame> {
    await expect(page.locator('iframe[title="Sourdaw"]')).toHaveCount(1);
    const frame = page.frames().find((candidate) => candidate.parentFrame() === page.mainFrame());
    if (frame === undefined) {
        throw new Error('The browser display-scale host did not create an application frame');
    }
    return frame;
}

/**
 * TransportBar's compact threshold (COMPACT_TRANSPORT_MAX_WIDTH): at or below
 * this CSS viewport width the transport collapses its direct actions, and
 * "Open Preferences" moves into the "View and panel controls" popover as a
 * "Preferences" item. At 125% and 200% display scale this 1280px-wide host
 * yields 1024px and 640px viewports, so the compact route is the only one the
 * product offers there — the same route a user at that scale takes.
 */
const COMPACT_TRANSPORT_MAX_WIDTH = 1199;

async function openPreferencesDialog(app: FrameLocator, frame: Frame): Promise<void> {
    const compactTransport = await frame.evaluate(
        (maxWidth) => window.innerWidth <= maxWidth,
        COMPACT_TRANSPORT_MAX_WIDTH
    );
    if (compactTransport) {
        await app.getByRole('button', { name: 'View and panel controls' }).click();
        await app.getByRole('button', { name: 'Preferences', exact: true }).click();
        return;
    }
    await app.getByRole('button', { name: 'Open Preferences' }).click();
}

async function setDisplayScale(app: FrameLocator, frame: Frame, scale: number): Promise<Locator> {
    await openPreferencesDialog(app, frame);
    const dialog = app.getByRole('dialog').filter({ hasText: /Preferences/i });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Appearance', exact: true }).click();

    const slider = dialog.getByRole('slider', { name: 'UI Scale' });
    if (scale === 0.5) {
        await slider.press('Home');
    } else if (scale === 2) {
        await slider.press('End');
    } else {
        await slider.press('Home');
        const steps = Math.round((scale - 0.5) / 0.05);
        for (let step = 0; step < steps; step += 1) {
            await slider.press('ArrowRight');
        }
    }
    await expect(slider).toHaveAttribute('aria-valuenow', String(scale * 100));
    await expect.poll(async () => frame.evaluate(() => window.innerWidth)).toBe(Math.round(VIEWPORT.width / scale));

    return dialog;
}

async function expectUiScaleDragKeepsGeometryUntilCommit(page: Page, frame: Frame, dialog: Locator): Promise<void> {
    const slider = dialog.getByRole('slider', { name: 'UI Scale' });
    const sliderRoot = dialog.locator('[data-slot="slider"]');
    await expect(sliderRoot).toHaveCount(1);
    const sliderBox = requireBox(await slider.boundingBox(), 'UI Scale slider thumb');
    const sliderRootBox = requireBox(await sliderRoot.boundingBox(), 'UI Scale slider');
    const dialogBox = requireBox(await dialog.boundingBox(), 'Preferences dialog');
    const initialSliderValue = Number(await slider.getAttribute('aria-valuenow'));
    const initialInnerWidth = await frame.evaluate(() => window.innerWidth);

    await page.mouse.move(sliderBox.x + sliderBox.width / 2, sliderBox.y + sliderBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(sliderBox.x + sliderBox.width / 2 + 32, sliderBox.y + sliderBox.height / 2);

    await expect
        .poll(async () => Number(await slider.getAttribute('aria-valuenow')))
        .toBeGreaterThan(initialSliderValue);
    expect(await frame.evaluate(() => window.innerWidth)).toBe(initialInnerWidth);
    const draftSliderRootBox = requireBox(await sliderRoot.boundingBox(), 'UI Scale slider during drag');
    const draftDialogBox = requireBox(await dialog.boundingBox(), 'Preferences dialog during drag');
    expect(draftSliderRootBox.x).toBeCloseTo(sliderRootBox.x, 4);
    expect(draftSliderRootBox.y).toBeCloseTo(sliderRootBox.y, 4);
    expect(draftSliderRootBox.width).toBeCloseTo(sliderRootBox.width, 4);
    expect(draftSliderRootBox.height).toBeCloseTo(sliderRootBox.height, 4);
    expect(draftDialogBox.x).toBeCloseTo(dialogBox.x, 4);
    expect(draftDialogBox.y).toBeCloseTo(dialogBox.y, 4);
    expect(draftDialogBox.width).toBeCloseTo(dialogBox.width, 4);
    expect(draftDialogBox.height).toBeCloseTo(dialogBox.height, 4);

    await page.mouse.up();

    const committedScale = Number(await slider.getAttribute('aria-valuenow')) / 100;
    expect(committedScale).toBeGreaterThan(1);
    await expect
        .poll(async () => frame.evaluate(() => window.innerWidth))
        .toBe(Math.round(VIEWPORT.width / committedScale));
}

async function expectScrollableAncestor(locator: Locator, shouldScroll: boolean): Promise<void> {
    const scrollState = await locator.evaluate((element) => {
        let ancestor = element.parentElement;
        while (ancestor !== null && window.getComputedStyle(ancestor).overflowY !== 'auto') {
            ancestor = ancestor.parentElement;
        }
        if (ancestor === null) {
            return null;
        }
        return {
            clientHeight: ancestor.clientHeight,
            scrollHeight: ancestor.scrollHeight,
            scrollTop: ancestor.scrollTop,
        };
    });
    expect(scrollState).not.toBeNull();
    if (shouldScroll) {
        expect(scrollState!.scrollHeight).toBeGreaterThan(scrollState!.clientHeight);
        expect(scrollState!.scrollTop).toBeGreaterThan(0);
    }
}

async function expectPreferencesUsable(app: FrameLocator, dialog: Locator, scale: number): Promise<void> {
    await dialog.getByRole('button', { name: 'General', exact: true }).click();
    const lastContentControl = dialog.getByRole('button', { name: /Click to change — hold to activate voice input/i });
    await lastContentControl.scrollIntoViewIfNeeded();
    await expect(lastContentControl).toBeVisible();

    const done = dialog.getByRole('button', { name: 'Done', exact: true });
    await done.scrollIntoViewIfNeeded();
    await expect(done).toBeVisible();

    const dialogBox = requireBox(await dialog.boundingBox(), 'Preferences dialog');
    const lastControlBox = requireBox(await lastContentControl.boundingBox(), 'last Preferences control');
    const doneBox = requireBox(await done.boundingBox(), 'Preferences footer');
    expectInsideViewport(dialogBox);
    expect(lastControlBox.y).toBeGreaterThanOrEqual(dialogBox.y);
    expect(lastControlBox.y + lastControlBox.height).toBeLessThanOrEqual(dialogBox.y + dialogBox.height);
    expect(doneBox.y).toBeGreaterThanOrEqual(dialogBox.y);
    expect(doneBox.y + doneBox.height).toBeLessThanOrEqual(dialogBox.y + dialogBox.height);

    await expectScrollableAncestor(lastContentControl, scale === 2);
    await expectScrollableAncestor(done, scale === 2);
    await done.click();
    await expect(app.getByRole('dialog').filter({ hasText: /Preferences/i })).toHaveCount(0);
}

async function expectFrameGeometry(page: Page, frame: Frame, scale: number): Promise<void> {
    const frameBox = requireBox(await page.locator('iframe[title="Sourdaw"]').boundingBox(), 'application frame');
    expect(frameBox.x).toBeCloseTo(0, 4);
    expect(frameBox.y).toBeCloseTo(0, 4);
    expect(frameBox.width).toBeCloseTo(VIEWPORT.width, 4);
    expect(frameBox.height).toBeCloseTo(VIEWPORT.height, 4);

    const geometry = await frame.evaluate(() => {
        const shell = document.querySelector<HTMLElement>('[data-testid="app-shell"]');
        const shellBox = shell?.getBoundingClientRect();
        return {
            bodyScrollHeight: document.body.scrollHeight,
            bodyScrollWidth: document.body.scrollWidth,
            clientHeight: document.documentElement.clientHeight,
            clientWidth: document.documentElement.clientWidth,
            innerHeight: window.innerHeight,
            innerWidth: window.innerWidth,
            scrollHeight: document.documentElement.scrollHeight,
            scrollWidth: document.documentElement.scrollWidth,
            shell: shellBox ? { x: shellBox.x, y: shellBox.y, width: shellBox.width, height: shellBox.height } : null,
        };
    });
    expect(geometry.innerWidth).toBe(Math.round(VIEWPORT.width / scale));
    expect(geometry.innerHeight).toBe(Math.round(VIEWPORT.height / scale));
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
    expect(geometry.scrollHeight).toBeLessThanOrEqual(geometry.clientHeight);
    expect(geometry.bodyScrollWidth).toBeLessThanOrEqual(geometry.innerWidth);
    expect(geometry.bodyScrollHeight).toBeLessThanOrEqual(geometry.innerHeight);
    expect(geometry.shell).toEqual({
        x: 0,
        y: 0,
        width: geometry.innerWidth,
        height: geometry.innerHeight,
    });
}

async function expectRestoredFrameReceivesGlobalShortcut(page: Page, app: FrameLocator): Promise<void> {
    await page.evaluate(() => {
        document.body.tabIndex = -1;
        document.body.focus();
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await expect.poll(() => page.evaluate(() => document.activeElement instanceof HTMLIFrameElement)).toBe(true);

    const isMac = await page.evaluate(() => navigator.platform.toUpperCase().includes('MAC'));
    await page.keyboard.press(isMac ? 'Meta+K' : 'Control+K');
    const palette = app.getByRole('dialog', { name: /Command Palette/i });
    await expect(palette).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(palette).toHaveCount(0);
    await page.evaluate(() => document.body.removeAttribute('tabindex'));
}

async function expectContextMenuUsable(app: FrameLocator, scale: number): Promise<void> {
    const trackRow = app
        .getByRole('grid', { name: /Track list/i })
        .first()
        .getByRole('row')
        .filter({ hasText: /MIDI/i })
        .first();
    const rowBox = requireBox(await trackRow.boundingBox(), 'MIDI track row');
    const clickPoint = { x: rowBox.x + rowBox.width / 2, y: rowBox.y + rowBox.height / 2 };
    await trackRow.click({ button: 'right' });

    const menu = app.getByRole('menu');
    await expect(menu).toBeVisible();
    const menuBox = requireBox(await menu.boundingBox(), 'track context menu');
    expectInsideViewport(menuBox);
    // The menu anchors on the app's own pixel grid, and one app pixel spans
    // `scale` host pixels, so anchor rounding may land up to that far from the
    // pointer in host coordinates.
    expect(Math.abs(menuBox.x - clickPoint.x)).toBeLessThanOrEqual(Math.max(1, scale));
    expect(menuBox.y).toBeLessThanOrEqual(clickPoint.y);
    expect(menuBox.y + menuBox.height).toBeGreaterThanOrEqual(clickPoint.y);

    if (scale === 2) {
        const scrollState = await menu.evaluate((element) => ({
            clientHeight: element.clientHeight,
            overflowY: window.getComputedStyle(element).overflowY,
            scrollHeight: element.scrollHeight,
        }));
        expect(scrollState.overflowY).toBe('auto');
        expect(scrollState.scrollHeight).toBeGreaterThan(scrollState.clientHeight);
        const lastItem = menu.getByRole('menuitem').last();
        await lastItem.scrollIntoViewIfNeeded();
        await expect(lastItem).toBeVisible();
    }
    await menu.getByRole('menuitem').first().press('Escape');
    await expect(menu).toHaveCount(0);
}

async function expectRightEdgeContextMenuClamped(page: Page, app: FrameLocator, scale: number): Promise<void> {
    const timeline = app.getByLabel('Timeline editor surface');
    const timelineBox = requireBox(await timeline.boundingBox(), 'timeline editor');
    const clickPoint = {
        x: timelineBox.x + timelineBox.width - 4,
        y: timelineBox.y + timelineBox.height / 2,
    };
    await page.mouse.click(clickPoint.x, clickPoint.y, { button: 'right' });

    const menu = app.getByRole('menu');
    await expect(menu).toBeVisible();
    const menuBox = requireBox(await menu.boundingBox(), 'right-edge context menu');
    expectInsideViewport(menuBox);
    // One app pixel spans `scale` host pixels, so anchor rounding may land up
    // to that far from the pointer in host coordinates.
    const anchorTolerance = Math.max(1, scale);
    // Clamping is owed only when the menu cannot fit to the right of the
    // pointer — at 50% scale the half-size menu fits and must open at the
    // pointer like any context menu. When it cannot fit, it must shift left;
    // expectInsideViewport above fails a missing clamp either way.
    if (clickPoint.x + menuBox.width > VIEWPORT.width) {
        expect(menuBox.x).toBeLessThan(clickPoint.x);
    } else {
        expect(Math.abs(menuBox.x - clickPoint.x)).toBeLessThanOrEqual(anchorTolerance);
    }
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(VIEWPORT.width);
    const attachedBelow = Math.abs(menuBox.y - clickPoint.y) <= anchorTolerance;
    const attachedAbove = Math.abs(menuBox.y + menuBox.height - clickPoint.y) <= anchorTolerance;
    expect(attachedBelow || attachedAbove).toBe(true);

    await menu.getByRole('menuitem').first().press('Escape');
    await expect(menu).toHaveCount(0);
}

async function expectRecentProjectsMenuUsable(frame: Frame, app: FrameLocator, scale: number): Promise<void> {
    await frame.evaluate(async (entries) => {
        const { recentProjectsStorage } = await import('/src/modules/Project/useCases/recentProjects/helpers.ts');
        recentProjectsStorage.set(entries);
    }, RECENT_PROJECTS);

    await app.getByRole('button', { name: 'Project menu', exact: true }).click();
    const menu = app.getByRole('menu', { name: 'Project menu' });
    await expect(menu).toBeVisible();
    const lastRecent = menu.getByRole('menuitem').filter({ hasText: 'Recent Project 10' });
    await lastRecent.scrollIntoViewIfNeeded();
    await expect(lastRecent).toBeVisible();

    const menuBox = requireBox(await menu.boundingBox(), 'Project menu');
    expectInsideViewport(menuBox);
    const scrollState = await menu.evaluate((element) => ({
        clientHeight: element.clientHeight,
        overflowY: window.getComputedStyle(element).overflowY,
        scrollHeight: element.scrollHeight,
        scrollTop: element.scrollTop,
    }));
    expect(scrollState.overflowY).toBe('auto');
    if (scale === 2) {
        expect(scrollState.scrollHeight).toBeGreaterThan(scrollState.clientHeight);
        expect(scrollState.scrollTop).toBeGreaterThan(0);
    }

    await lastRecent.hover();
    const remove = lastRecent.getByRole('button', { name: 'Remove Recent Project 10 from recent projects' });
    await expect(remove).toBeVisible();
    await remove.click();
    await expect(lastRecent).toHaveCount(0);
    await menu.getByRole('menuitem').first().press('Escape');
    await expect(menu).toHaveCount(0);
}

async function expectEqCanvasDrag(page: Page, app: FrameLocator): Promise<void> {
    const inspector = app.getByRole('complementary', { name: 'Inspector panel' });
    await inspector.getByText('Proof', { exact: false }).first().click();
    await expect(app.getByRole('button', { name: /reset loudness/i })).toBeVisible({ timeout: 15_000 });
    await app.getByRole('button', { name: 'Build Modules' }).click();
    const canvas = app.getByLabel('8-band parametric EQ frequency response');
    const band = app.getByRole('slider', { name: /EQ band 1/i });
    await canvas.scrollIntoViewIfNeeded();
    await expect(canvas).toBeVisible();
    // Scroll the drag target itself into view, as a user would: at 200% scale
    // the plugin window is narrower than the fixed-size EQ surface, and
    // scrolling the canvas centers it, which leaves the lowest band outside
    // the visible slice.
    await band.scrollIntoViewIfNeeded();
    const bandBox = requireBox(await band.boundingBox(), 'EQ band handle');
    const before = Number(await band.getAttribute('aria-valuenow'));

    await page.mouse.move(bandBox.x + bandBox.width / 2, bandBox.y + bandBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(bandBox.x + bandBox.width / 2 + 30, bandBox.y + bandBox.height / 2);
    await page.mouse.up();

    await expect.poll(async () => Number(await band.getAttribute('aria-valuenow'))).toBeGreaterThan(before);
    await app.getByRole('button', { name: 'Close Proof' }).click();
    await expect(canvas).toHaveCount(0);
}

async function expectExportUsable(page: Page, app: FrameLocator): Promise<void> {
    const isMac = await page.evaluate(() => navigator.platform.toUpperCase().includes('MAC'));
    await app.locator('body').press(isMac ? 'Meta+Shift+E' : 'Control+Shift+E');
    const dialog = app.getByRole('dialog').filter({ hasText: /The Bakery/i });
    await expect(dialog).toBeVisible();
    const start = dialog.getByTestId('export-start');
    await expect(start).toBeVisible();

    const dialogBox = requireBox(await dialog.boundingBox(), 'Export dialog');
    const startBox = requireBox(await start.boundingBox(), 'Export footer action');
    expectInsideViewport(dialogBox);
    expect(startBox.y).toBeGreaterThanOrEqual(dialogBox.y);
    expect(startBox.y + startBox.height).toBeLessThanOrEqual(dialogBox.y + dialogBox.height);

    await app.locator('body').press('Escape');
    await expect(dialog).toHaveCount(0);
}

test('browser display scale preserves viewport geometry and interactions at 50%, 100%, 125%, and 200%', async ({
    page,
}) => {
    test.setTimeout(160_000);
    await page.setViewportSize(VIEWPORT);
    const alphaDismissed = superjsonStringify(true);
    await page.addInitScript((dismissed) => {
        if (window.parent !== window) {
            return;
        }
        window.localStorage.clear();
        window.localStorage.setItem('wd:onboarding-completed', '1');
        window.localStorage.setItem('sourdaw-alpha-notice-dismissed', dismissed);
        window.localStorage.setItem('wd:first-load-hint-shown', '1');
    }, alphaDismissed);
    await page.goto('/');

    const frame = await findApplicationFrame(page);
    const app = page.frameLocator('iframe[title="Sourdaw"]');
    await expect(app.getByLabel('Sourdaw — start a project')).toBeVisible({
        timeout: LAUNCH_SCREEN_FIRST_PAINT_TIMEOUT_MS,
    });
    await app.locator('#launch-new-project').click();
    await expect(app.getByRole('group', { name: 'Playback controls' })).toBeVisible({ timeout: 30_000 });
    await app.getByRole('button', { name: /Add blank MIDI track/ }).click();

    const inspector = app.getByRole('complementary', { name: 'Inspector panel' });
    await inspector.getByRole('button', { name: 'Add device' }).click();
    await app.getByRole('menuitem', { name: /^Proof$/ }).click();
    await expect(inspector.getByRole('button', { name: /^Bypass Proof$/i })).toBeVisible();

    expect(page.frames().filter((candidate) => candidate.parentFrame() === page.mainFrame())).toHaveLength(1);
    await expect(page.getByTestId('app-shell')).toHaveCount(0);
    await expect(app.getByTestId('app-shell')).toHaveCount(1);

    const dragPreferences = await setDisplayScale(app, frame, 1);
    await expectUiScaleDragKeepsGeometryUntilCommit(page, frame, dragPreferences);
    await dragPreferences.getByRole('button', { name: 'Done', exact: true }).click();

    for (const scale of [0.5, 1, 1.25, 2]) {
        const preferences = await setDisplayScale(app, frame, scale);
        await expectPreferencesUsable(app, preferences, scale);
        await expectFrameGeometry(page, frame, scale);
        await expectRestoredFrameReceivesGlobalShortcut(page, app);
        await expectRecentProjectsMenuUsable(frame, app, scale);
        await expectContextMenuUsable(app, scale);
        await expectRightEdgeContextMenuClamped(page, app, scale);
        await expectEqCanvasDrag(page, app);
        await expectExportUsable(page, app);
    }

    await frame.goto(frame.url());
    await expect(app.getByTestId('app-shell')).toHaveCount(1);
    await expect.poll(async () => frame.evaluate(() => window.innerWidth)).toBe(VIEWPORT.width / 2);
    await expectFrameGeometry(page, frame, 2);
});
