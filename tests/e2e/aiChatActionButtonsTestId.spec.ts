import { test, expect, type Page, type Locator } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

/**
 * The chat's pending-action controls (aria-label "Confirm pending actions" /
 * "Cancel pending actions" / "Retry missing section renders" in
 * src/modules/AiRuntime/presentations/views/ChatPanel.tsx) render only on an
 * assistant message whose pendingActionConfirmationStatus is 'proposed'.
 *
 * A deterministic route to that state is the apply-mode compound fast path
 * (`tryCompoundFastPath`): the command "create 3 audio tracks" plans three
 * addTrack actions, and any multi-action batch requires confirmation
 * (`requiresAppActionConfirmation`). No LLM inference, provider, or GPU is
 * involved: the composer's "Agent execution mode" select chooses the mode, and
 * `sendChatMessage` routes every non-explain mode straight to orchestration
 * (`interactionMode !== 'explain'`), where `parsePromptToActions` runs the
 * compound fast path before the provider-planning route can deny the request.
 * `navigator.gpu` presence is deliberately not consulted here — admission reads
 * the actual `requestAdapter` result, so a machine with no adapter still
 * reaches this state.
 */

const CONFIRM_BUTTON = (page: Page): Locator => page.getByRole('button', { name: 'Confirm pending actions' });
const CANCEL_BUTTON = (page: Page): Locator => page.getByRole('button', { name: 'Cancel pending actions' });
const RETRY_BUTTON = (page: Page): Locator => page.getByRole('button', { name: 'Retry missing section renders' });

async function open_chat_panel(page: Page): Promise<void> {
    await page.getByTestId('toggle-chat').click();
    await expect(page.getByTestId('chat-composer-input')).toBeVisible({ timeout: 10_000 });
}

async function assert_idle_contract(page: Page): Promise<void> {
    // No pending action exists, so none of the three action buttons render.
    await expect(CONFIRM_BUTTON(page)).toHaveCount(0);
    await expect(CANCEL_BUTTON(page)).toHaveCount(0);
    await expect(RETRY_BUTTON(page)).toHaveCount(0);

    // The panel itself stays interactive: the log is mounted and not busy.
    const log = page.getByRole('log', { name: 'Chat conversation' });
    await expect(log).toBeVisible();
    await expect(log).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByTestId('chat-composer-input')).toBeVisible();
}

test.describe('AI chat pending-action buttons — test-id targeted', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('pending action confirm/cancel buttons appear for a confirming command and vanish on cancel', async ({
        page,
    }) => {
        await open_chat_panel(page);

        const input = page.getByTestId('chat-composer-input');

        // Switch the composer from open-ended chat to command mode. The input
        // stays enabled with no backend, so its state is not an admission gate.
        await page.getByLabel('Agent execution mode').selectOption('apply');

        // Multi-action fast path: three addTrack actions force a confirmation
        // proposal, which mounts the Confirm/Cancel controls on the assistant
        // message.
        await input.fill('create 3 audio tracks');
        await input.press('Enter');

        await expect(CONFIRM_BUTTON(page)).toBeVisible({ timeout: 15_000 });
        await expect(CANCEL_BUTTON(page)).toBeVisible();
        // The retry control belongs to a different message status and must not
        // render alongside a fresh proposal.
        await expect(RETRY_BUTTON(page)).toHaveCount(0);

        // Cancelling settles the proposal: the assistant message flips to
        // 'cancelled', both controls unmount, and the log explains what was
        // dropped.
        await CANCEL_BUTTON(page).click();

        await expect(CONFIRM_BUTTON(page)).toBeHidden();
        await expect(CANCEL_BUTTON(page)).toBeHidden();
        await expect(page.getByRole('log', { name: 'Chat conversation' })).toContainText('Cancelled pending actions:');

        // The panel remains usable after the cancellation.
        await expect(input).toBeEnabled();
    });

    test('idle chat shows no pending-action buttons and stays interactive', async ({ page }) => {
        await open_chat_panel(page);
        await assert_idle_contract(page);
    });
});
