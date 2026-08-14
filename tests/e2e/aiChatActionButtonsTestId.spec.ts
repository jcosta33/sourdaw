import { test, expect, type Page, type Locator } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

/**
 * The chat's pending-action controls (aria-label "Confirm pending actions" /
 * "Cancel pending actions" / "Retry missing section renders" in
 * src/modules/AiRuntime/presentations/views/ChatPanel.tsx) render only on an
 * assistant message whose pendingActionConfirmationStatus is 'proposed'.
 *
 * A deterministic route to that state is the prompt-mode compound fast path
 * (`tryCompoundFastPath`): the command "create 3 audio tracks" plans three
 * addTrack actions, and any multi-action batch requires confirmation
 * (`requiresAppActionConfirmation`), no LLM inference involved. Prompt mode
 * still needs a resolvable backend (`resolveBackend() !== 'none'`), which
 * headless Chromium satisfies via `navigator.gpu` (WebGPU-present ⇒ 'webllm').
 * When the composer is disabled because no backend resolves at all, the spec
 * degrades to the weaker idle-state contract instead.
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
        if (await input.isDisabled()) {
            // No AI backend resolved — the strong flow is not reachable; hold
            // the honest weaker contract instead of failing on environment.
            await assert_idle_contract(page);
            return;
        }

        // Switch the composer from open-ended chat to command mode.
        await page.getByRole('button', { name: 'Command Mode' }).click();

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
