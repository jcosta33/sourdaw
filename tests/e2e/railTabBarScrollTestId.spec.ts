import { test, expect, type Locator, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

type MainRail = {
    /** The horizontal tab strip that actually scrolls (parent of the tab buttons). */
    scroller: Locator;
    scrollLeftButton: Locator;
    scrollRightButton: Locator;
};

async function ensureBrowserOpen(page: Page): Promise<void> {
    const search = page.getByTestId('browser-search');
    if (!(await search.isVisible().catch(() => false))) {
        await page.getByTestId('toggle-browser').click();
    }
    // The browser panel must be open; if it is not, the harness contract is
    // broken and the test must fail rather than silently skip.
    await expect(search).toBeVisible({ timeout: 10_000 });
}

/**
 * Locate the browser sidebar's main rail (Instruments | Effects | Library |
 * Macros | Project) plus its two scroll buttons.
 *
 * The rail renders tab buttons as direct children of the scrolling flex div,
 * and both scroll buttons live in the same relative wrapper one level above
 * that scroller, so the tab button's parent chain pins the trio without
 * relying on CSS classes or a global aria-label match (the Library sub-rail
 * mounts a second RailTabBar with its own scroll buttons).
 */
async function getMainRail(page: Page): Promise<MainRail> {
    const browser = page.getByRole('complementary', { name: 'Browser panel' });
    const instrumentsTab = browser.getByRole('button', { name: 'Instruments', exact: true });
    await expect(instrumentsTab).toBeVisible({ timeout: 10_000 });

    const scroller = instrumentsTab.locator('..');
    const railWrapper = scroller.locator('..');
    return {
        scroller,
        scrollLeftButton: railWrapper.getByRole('button', { name: 'Scroll tabs left' }),
        scrollRightButton: railWrapper.getByRole('button', { name: 'Scroll tabs right' }),
    };
}

/**
 * Gating note: the scroll buttons are always mounted but inert (opacity-0,
 * pointer-events-none, tabIndex -1) unless the tab strip overflows its
 * container. The sidebar width is a fixed 224px (AppShell style prop), not a
 * viewport fraction, so at the default Playwright viewport the five main-rail
 * tabs overflow and the right button is active. The overflow assertion below
 * is the honest gate: if the tabs ever fit, it fails and says so instead of
 * pretending the buttons were exercised.
 */
test.describe('RailTabBar scroll buttons — browser sidebar', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await ensureBrowserOpen(page);
    });

    test('scroll buttons are gated on overflow and scroll the main rail back and forth', async ({ page }) => {
        const { scroller, scrollLeftButton, scrollRightButton } = await getMainRail(page);

        // The five tabs must overflow the 224px sidebar for the scroll affordance to exist.
        const overflow = await scroller.evaluate((element) => element.scrollWidth - element.clientWidth);
        expect(overflow).toBeGreaterThan(1);

        // At scroll position 0 the left button is inert and the right one is active.
        await expect(scrollLeftButton).toHaveAttribute('tabindex', '-1');
        await expect(scrollRightButton).toHaveAttribute('tabindex', '0');

        // Scrolling right is a real state change on the strip: scrollLeft leaves 0.
        await scrollRightButton.click();
        await expect
            .poll(() => scroller.evaluate((element) => element.scrollLeft), { timeout: 10_000 })
            .toBeGreaterThan(0);

        // Having scrolled, the left button becomes active.
        await expect(scrollLeftButton).toHaveAttribute('tabindex', '0');

        // Scrolling back left returns the strip to its origin and re-gates the left button.
        await scrollLeftButton.click();
        await expect
            .poll(() => scroller.evaluate((element) => element.scrollLeft), { timeout: 10_000 })
            .toBeLessThanOrEqual(1);
        await expect(scrollLeftButton).toHaveAttribute('tabindex', '-1');
    });

    test('library sub-rail scroll button scrolls the Folders | Imported | Find strip', async ({ page }) => {
        const { scroller: mainScroller } = await getMainRail(page);
        await mainScroller.getByRole('button', { name: 'Library', exact: true }).click();

        // The sub-rail mounts inside the library view; find it via its own tab button.
        const browser = page.getByRole('complementary', { name: 'Browser panel' });
        const foldersTab = browser.getByRole('button', { name: 'Folders', exact: true });
        await expect(foldersTab).toBeVisible({ timeout: 10_000 });

        const subScroller = foldersTab.locator('..');
        const subWrapper = subScroller.locator('..');
        const subScrollRight = subWrapper.getByRole('button', { name: 'Scroll tabs right' });

        // Each sub-tab has a min width of 88px, so three of them overflow the
        // sidebar exactly like the main rail. Same honest gate as above.
        const overflow = await subScroller.evaluate((element) => element.scrollWidth - element.clientWidth);
        expect(overflow).toBeGreaterThan(1);
        await expect(subScrollRight).toHaveAttribute('tabindex', '0');

        await subScrollRight.click();
        await expect
            .poll(() => subScroller.evaluate((element) => element.scrollLeft), { timeout: 10_000 })
            .toBeGreaterThan(0);
    });
});
