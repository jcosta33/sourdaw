import { test, expect, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';
import { startLoopbackOpenAiProvider, type LoopbackOpenAiProvider } from './loopbackOpenAiProvider';

const LOOPBACK_REPLY = 'Loopback provider reply for the confirm/apply/undo proof.';

/**
 * Points the running app at the loopback endpoint through its own product use
 * cases, so admission is decided by `configureCloudProvider` and the backend
 * chain rather than by anything the test fakes.
 */
async function admitLoopbackProvider(page: Page, provider: LoopbackOpenAiProvider): Promise<void> {
    await page.evaluate(
        async ({ baseUrl, model }) => {
            const { configureCloudProvider } =
                await import('/src/modules/AiRuntime/useCases/cloudApiManagement/configureCloudProvider.ts');
            const { setAiBackendPreference } =
                await import('/src/modules/AiRuntime/useCases/llmOrchestration/backendResolution/setAiBackendPreference.ts');
            await configureCloudProvider({ provider: 'openai-compatible', model, baseUrl });
            setAiBackendPreference('cloud');
        },
        { baseUrl: provider.baseUrl, model: provider.model }
    );
}

function trackArmButtons(page: Page) {
    return page
        .getByRole('grid', { name: /Track list/i })
        .first()
        .getByRole('button', { name: /^Arm / });
}

async function openChatPanel(page: Page): Promise<void> {
    await page.getByTestId('toggle-chat').click();
    await expect(page.getByTestId('chat-composer-input')).toBeVisible({ timeout: 10_000 });
}

// The confirm half of the prompt flow: proposal buttons are covered
// (mount + cancel) but no spec clicks Confirm and asserts the project actually
// mutates, let alone that the applied batch is undoable and redoable.
//
// The composer needs an admitted AI backend. WebGPU cannot supply one on a
// GPU-less runner, so these tests admit the other documented browser path: an
// unauthenticated OpenAI-compatible endpoint on loopback, configured through
// the product's own `configureCloudProvider`.
test.describe('AI chat over an admitted loopback provider', () => {
    let provider: LoopbackOpenAiProvider;

    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        provider = await startLoopbackOpenAiProvider({ reply: LOOPBACK_REPLY });
        await setupWorkspace(page);
        await launch_new_project(page);
        await admitLoopbackProvider(page, provider);
        await openChatPanel(page);
    });

    test.afterEach(async () => {
        await provider.close();
    });

    // Admission is only worth asserting if the configured endpoint is the one
    // the app actually talks to: an explain-mode prompt bypasses the local
    // fast paths and streams straight from the provider.
    test('streams a chat answer from the configured loopback endpoint', async ({ page }) => {
        const input = page.getByTestId('chat-composer-input');
        await expect(input).toBeEnabled();

        const executionMode = page.getByRole('combobox', { name: 'Agent execution mode' });
        await expect(executionMode).toHaveValue('explain');

        await input.fill('What does this project sound like?');
        await input.press('Enter');

        const conversation = page.getByRole('log', { name: 'Chat conversation' });
        await expect(conversation).toContainText(LOOPBACK_REPLY, { timeout: 30_000 });
        expect(provider.completionRequests.length).toBeGreaterThan(0);
        expect(provider.completionRequests[0]).toContain(provider.model);
    });

    test('confirming "create 3 audio tracks" adds the tracks, undo restores, redo re-applies', async ({ page }) => {
        const input = page.getByTestId('chat-composer-input');
        await expect(input).toBeEnabled();

        const executionMode = page.getByRole('combobox', { name: 'Agent execution mode' });
        await executionMode.selectOption('apply');
        await expect(executionMode).toHaveValue('apply');
        const baseline = await trackArmButtons(page).count();

        // Multi-action fast path forces a confirmation proposal.
        await input.fill('create 3 audio tracks');
        await input.press('Enter');
        const confirm = page.getByRole('button', { name: 'Confirm' });
        await expect(confirm).toBeVisible({ timeout: 15_000 });

        await confirm.click();
        // The confirmed batch runs through the action pipeline; give the
        // tracks the same landing allowance the proposal needed.
        await expect(trackArmButtons(page)).toHaveCount(baseline + 3, { timeout: 20_000 });

        // The batch is one grouped undo entry: undo removes all three tracks,
        // redo re-applies them.
        const undo = page.getByTestId('transport-undo');
        const redo = page.getByTestId('transport-redo');
        await expect(undo).toBeEnabled();
        await undo.click();
        await expect(trackArmButtons(page)).toHaveCount(baseline);

        await redo.click();
        await expect(trackArmButtons(page)).toHaveCount(baseline + 3);
    });
});
