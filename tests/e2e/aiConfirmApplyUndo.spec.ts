import { test, expect, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

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
test.describe('AI prompt → Confirm → apply → undo/redo', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openChatPanel(page);
    });

    test('confirming "create 3 audio tracks" adds the tracks, undo restores, redo re-applies', async ({ page }) => {
        const input = page.getByTestId('chat-composer-input');
        // The fast path is a local deterministic parser; if no backend
        // resolved at all the composer is disabled and this flow is
        // unreachable — that is an environment failure, not a pass.
        await expect(input).toBeEnabled();

        await page.getByRole('button', { name: 'Command Mode' }).click();
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
