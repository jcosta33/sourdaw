import { setupAgentBrowser } from './utils';

/**
 * Sample agent script to verify the basic DOM layout and extract information.
 * Run this via: node --experimental-strip-types .agents/ui-scripts/sample-interaction.ts
 */
async function main() {
    const { browser, page } = await setupAgentBrowser();

    try {
        // Example: Wait for the main app shell to load
        await page.waitForLoadState('domcontentloaded');

        // Extract basic data to return to the agent
        const title = await page.title();
        const screenshotPath = '.agents/ui-scripts/sample-screenshot.png';

        // Take a screenshot for the agent to analyze visually
        await page.screenshot({ path: screenshotPath });

        const output = {
            title,
            screenshotPath,
            success: true,
            timestamp: new Date().toISOString(),
        };

        // Output as JSON so the agent can parse it easily
        console.log(JSON.stringify(output, null, 2));
    } catch (error) {
        console.error(
            JSON.stringify(
                {
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                },
                null,
                2
            )
        );
        process.exit(1);
    } finally {
        await browser.close();
    }
}

main();
