import { expect, test, type Frame, type FrameLocator, type Locator, type Page } from '@playwright/test';
import { stringify as superjsonStringify } from 'superjson';

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

async function setDisplayScale(app: FrameLocator, frame: Frame, scale: number): Promise<Locator> {
    await app.getByRole('button', { name: 'Open Preferences' }).click();
    const dialog = app.getByRole('dialog').filter({ hasText: /Preferences/i });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Appearance', exact: true }).click();

    const slider = dialog.getByRole('slider', { name: 'UI Scale' });
    if (scale === 0.5) {
        await slider.press('Home');
    } else if (scale === 1) {
        await slider.press('Home');
        for (let step = 0; step < 10; step += 1) {
            await slider.press('ArrowRight');
        }
    } else {
        await slider.press('End');
    }
    await expect(slider).toHaveAttribute('aria-valuenow', String(scale * 100));
    await expect.poll(async () => frame.evaluate(() => window.innerWidth)).toBe(Math.round(VIEWPORT.width / scale));

    return dialog;
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
    expect(menuBox.x).toBeCloseTo(clickPoint.x, 0);
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

async function expectRightEdgeContextMenuClamped(page: Page, app: FrameLocator): Promise<void> {
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
    expect(menuBox.x).toBeLessThan(clickPoint.x);
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(VIEWPORT.width);
    const attachedBelow = Math.abs(menuBox.y - clickPoint.y) <= 1;
    const attachedAbove = Math.abs(menuBox.y + menuBox.height - clickPoint.y) <= 1;
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

test('browser display scale preserves viewport geometry and interactions at 50%, 100%, and 200%', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(VIEWPORT);
    const alphaDismissed = superjsonStringify(true);
    await page.addInitScript((dismissed) => {
        window.localStorage.clear();
        window.localStorage.setItem('wd:onboarding-completed', '1');
        window.localStorage.setItem('sourdaw-alpha-notice-dismissed', dismissed);
        window.localStorage.setItem('wd:first-load-hint-shown', '1');
    }, alphaDismissed);
    await page.goto('/');

    const frame = await findApplicationFrame(page);
    const app = page.frameLocator('iframe[title="Sourdaw"]');
    await expect(app.getByLabel('Sourdaw — start a project')).toBeVisible();
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

    for (const scale of [0.5, 1, 2]) {
        const preferences = await setDisplayScale(app, frame, scale);
        await expectPreferencesUsable(app, preferences, scale);
        await expectFrameGeometry(page, frame, scale);
        await expectRestoredFrameReceivesGlobalShortcut(page, app);
        await expectRecentProjectsMenuUsable(frame, app, scale);
        await expectContextMenuUsable(app, scale);
        await expectRightEdgeContextMenuClamped(page, app);
        await expectEqCanvasDrag(page, app);
        await expectExportUsable(page, app);
    }
});
