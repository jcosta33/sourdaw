import { chromium } from 'playwright';

/**
 * Setup a headless browser for agent UI investigations.
 * @returns A tuple of [browser, page] that the caller must close when done.
 */
export async function setupAgentBrowser() {
    const browser = await chromium.launch();
    try {
        const context = await browser.newContext();
        const page = await context.newPage();

        // Navigate to the local dev server (configurable via BASE_URL)
        const baseUrl = process.env.BASE_URL || 'http://localhost:5173';
        await page.goto(baseUrl);

        return { browser, page };
    } catch (error) {
        await browser.close();
        throw error;
    }
}
