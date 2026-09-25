import { expect, test, type Page, type Locator } from '@playwright/test';
import { stringify as superjsonStringify } from 'superjson';

import { launch_new_project, RECENT_PROJECTS_STORAGE_KEY, setupWorkspace } from './e2eUtils';

/**
 * Two controls the final audit found with zero e2e hits:
 *
 * 1. PromptBar's `aria-label="Cancel AI processing"` button
 *    (src/modules/WorkspaceShell/presentations/views/PromptBar.tsx). It renders
 *    only while `usePromptExecution().isProcessing` is true and no preview is
 *    pending. That state is NOT deterministically reachable in e2e:
 *
 *    - Submitting a deterministic-parser command (compound fast path, e.g.
 *      "create 3 audio tracks") flips `isProcessing` on and off within one
 *      microtask chain — the compound planner has no real async boundary, so
 *      React commits the confirmation preview (or the executed result)
 *      directly and the intermediate processing render never becomes
 *      observable.
 *    - Confirming a multi-action preview runs the 32-action batch the same
 *      way: verified empirically — the batch commits completely with the bar
 *      already back at idle, so the control never mounts for Playwright.
 *    - The only route that holds `isProcessing` open is real LLM inference
 *      (`generateToolPlanningOutcome`), which needs a downloaded on-device
 *      model — network/disk-gated, not deterministic.
 *
 *    So this spec holds the honest contract instead: along every
 *    deterministic prompt-bar route (idle, review awaiting, review-cancelled,
 *    batch-confirmed), the control stays unmounted while the prompt pipeline
 *    demonstrably works (the awaiting-review indicator mounts, cancelling it
 *    unmounts the indicator, the confirmed batch lands its tracks and success
 *    notice).
 *
 * 2. LaunchScreen's `aria-label="Open recent project <name>"` cards
 *    (src/modules/WorkspaceShell/presentations/views/LaunchScreen.tsx). They
 *    render only when `getRecentProjects()` finds sanitized entries under the
 *    `sourdaw-recent-projects` localStorage key (superjson-serialized — see
 *    `createLocalStorage` in src/infra/store/storage). A fresh e2e profile has
 *    none, so the spec asserts both the empty state and the seeded state. The
 *    seeded entry points at a key with no stored project, so opening it fails
 *    deterministically with the `Failed to open "<name>"` notice and returns
 *    to the launch home view.
 */

const CANCEL_PROCESSING = (page: Page): Locator => page.getByRole('button', { name: 'Cancel AI processing' });

test.describe('PromptBar cancel-processing control', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
    });

    test('cancel-processing stays unmounted across every deterministic prompt-bar route', async ({ page }) => {
        const input = page.getByTestId('prompt-input');
        const awaiting_review = page.getByText('Changes awaiting review', { exact: true });
        const review_in_agent = page.getByRole('button', { name: 'Review in Agent' });
        const agent_confirm = page.getByRole('button', { name: 'Confirm agent actions' });
        const agent_cancel = page.getByRole('button', { name: 'Cancel agent actions' });

        // Idle contract: nothing is processing or awaiting review, so the
        // control does not mount and the input is interactive.
        await expect(input).toBeVisible();
        await expect(input).toBeEnabled();
        await expect(CANCEL_PROCESSING(page)).toHaveCount(0);
        await expect(awaiting_review).toHaveCount(0);
        await expect(agent_confirm).toHaveCount(0);
        await expect(agent_cancel).toHaveCount(0);

        // Compound fast path (no LLM): three addTrack actions plan
        // deterministically and any multi-action batch requires confirmation.
        // The prompt bar raises the review and hands the actions to the Agent
        // surface rather than rendering its own confirm/cancel controls.
        await input.fill('create 3 audio tracks');
        await input.press('Enter');

        await expect(awaiting_review).toBeVisible({ timeout: 15_000 });
        await expect(review_in_agent).toBeVisible();
        // The Agent surface's controls mount only after the review route is
        // taken, so neither is reachable before it.
        await expect(agent_confirm).toHaveCount(0);
        await expect(agent_cancel).toHaveCount(0);
        // The review replaces the main bar, so the processing cancel cannot
        // coexist with the approval controls.
        await expect(CANCEL_PROCESSING(page)).toHaveCount(0);

        await review_in_agent.click();
        await expect(agent_cancel).toBeVisible({ timeout: 15_000 });

        // Cancelling the review settles it: the approval controls unmount, the
        // bar returns to idle, and the processing cancel still never mounts.
        await agent_cancel.click();

        await expect(awaiting_review).toHaveCount(0);
        await expect(CANCEL_PROCESSING(page)).toHaveCount(0);
        await expect(input).toBeEnabled();

        // The confirmed route executes for real: the review's batch commits,
        // the AiChangeToast (role="status") reports the success, the tracks land
        // in the track list — and the processing control remains unmounted
        // before, during, and after (the batch never yields an observable
        // processing state; see the file header).
        await input.fill('create 32 audio tracks');
        await input.press('Enter');

        await expect(awaiting_review).toBeVisible({ timeout: 15_000 });
        await review_in_agent.click();
        await expect(agent_confirm).toBeVisible({ timeout: 15_000 });
        await agent_confirm.click();

        const success_notice = page.getByRole('status').filter({ hasText: 'Confirmed: create 32 audio tracks' });
        await expect(success_notice.first()).toBeVisible({ timeout: 15_000 });

        const track_list = page.getByRole('grid', { name: /Track list/i });
        await expect(track_list).toBeVisible();
        // A track row and its device row can both carry the track name, so take
        // the first match — one visible row proves the track landed.
        await expect(track_list.getByRole('row').filter({ hasText: 'Audio 32' }).first()).toBeVisible({
            timeout: 15_000,
        });

        await expect(CANCEL_PROCESSING(page)).toHaveCount(0);
        await expect(input).toBeEnabled();
    });

    test('idle prompt bar after a completed command shows no cancel-processing control', async ({ page }) => {
        const input = page.getByTestId('prompt-input');

        // A single-action fast-path command ("create 1 midi track" → one
        // addTrack, no confirmation needed) executes synchronously and settles
        // before the processing state could ever paint — the honest idle
        // contract is that the control never lingers and the input resets.
        await input.fill('create 1 midi track');
        await input.press('Enter');

        await expect(CANCEL_PROCESSING(page)).toHaveCount(0);
        await expect(input).toBeEnabled({ timeout: 10_000 });
        await expect(input).toHaveValue('');
    });
});

test.describe('LaunchScreen recent-project cards', () => {
    test('fresh profile renders no recent-project cards', async ({ page }) => {
        await setupWorkspace(page);

        const launch_screen = page.getByLabel('Sourdaw — start a project');
        await expect(launch_screen).toBeVisible({ timeout: 15_000 });

        // No `sourdaw-recent-projects` entry exists, so the whole recents block
        // (list plus cards) stays unmounted while the primary actions render.
        await expect(page.getByRole('list', { name: 'Recent projects' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: /^Open recent project / })).toHaveCount(0);
        await expect(page.locator('#launch-new-project')).toBeVisible();
    });

    test('seeded recent renders its card and reports a failed open for a missing project', async ({ page }) => {
        // Mirror the superjson form `createLocalStorage` parses: an array of
        // { name, key, updatedAt } entries under the app's recents key.
        const seeded = superjsonStringify([
            { name: 'Recent Mix', key: 'e2e-missing-recent-project', updatedAt: Date.now() },
        ]);
        await setupWorkspace(page, {
            localStorage: [{ name: RECENT_PROJECTS_STORAGE_KEY, value: seeded }],
        });

        const launch_screen = page.getByLabel('Sourdaw — start a project');
        await expect(launch_screen).toBeVisible({ timeout: 15_000 });

        const recent_card = page.getByRole('button', { name: 'Open recent project Recent Mix' });
        await expect(recent_card).toBeVisible();

        // The seeded key has no stored project, so loadRecentProject resolves
        // 'not-found': an error notice fires and the launch screen returns home.
        await recent_card.click();

        const error_notice = page.getByRole('alert').filter({ hasText: 'Failed to open "Recent Mix"' });
        await expect(error_notice).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('#launch-new-project')).toBeVisible({ timeout: 15_000 });
    });
});
