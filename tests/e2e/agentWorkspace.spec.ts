import { test, expect, type Locator, type Page } from '@playwright/test';

import { admitLoopbackProvider } from './admitLoopbackProvider';
import { launch_new_project, setupWorkspace } from './e2eUtils';
import { startLoopbackOpenAiProvider, type LoopbackOpenAiProvider } from './loopbackOpenAiProvider';

const LOOPBACK_REPLY = 'Loopback provider reply for the agent workspace proof.';

/** The multi-action fast path: enough actions to force a confirmation proposal rather than a direct apply. */
const PROMPT = 'create 3 audio tracks';

/** `AgentApprovalSection.tsx` labels the card's commit control; the chat panel's own Confirm reads plain "Confirm". */
const WORKSPACE_CONFIRM_NAME = 'Confirm agent actions';

/** Bounded so a workspace that never hands focus on fails instead of walking the whole document forever. */
const MAX_TAB_PRESSES = 40;

function trackArmButtons(page: Page): Locator {
    return page
        .getByRole('grid', { name: /Track list/i })
        .first()
        .getByRole('button', { name: /^Arm / });
}

function agentWorkspace(page: Page): Locator {
    return page.getByTestId('agent-workspace');
}

async function openChatPanel(page: Page): Promise<void> {
    await page.getByTestId('toggle-chat').click();
    await expect(page.getByTestId('chat-composer-input')).toBeVisible({ timeout: 10_000 });
}

/**
 * The bottom dock starts closed (`defaultWorkspaceState.mixerOpen`), and the
 * Agent tab only exists while it is open, so the dock toggle comes first — and
 * only when the tab is not already there, because the toggle would otherwise
 * close a dock some earlier step opened.
 */
async function openAgentWorkspace(page: Page): Promise<Locator> {
    const agentTab = page.getByTestId('agent-tab-button');
    if ((await agentTab.count()) === 0) {
        await page.getByTestId('toggle-bottom-dock').click();
    }
    await agentTab.click({ timeout: 10_000 });
    const workspace = agentWorkspace(page);
    await expect(workspace).toBeVisible({ timeout: 10_000 });
    return workspace;
}

/** Sends the multi-action prompt in apply mode and returns the track count it has to be read against. */
async function proposeThreeTracks(page: Page): Promise<number> {
    const input = page.getByTestId('chat-composer-input');
    await expect(input).toBeEnabled();

    const executionMode = page.getByRole('combobox', { name: 'Agent execution mode' });
    await executionMode.selectOption('apply');
    await expect(executionMode).toHaveValue('apply');
    const baseline = await trackArmButtons(page).count();

    await input.fill(PROMPT);
    await input.press('Enter');
    await expect(page.getByRole('button', { name: 'Confirm' }).first()).toBeVisible({ timeout: 15_000 });

    return baseline;
}

function approvalCard(workspace: Locator): Locator {
    return workspace.getByRole('region', { name: 'Approvals' });
}

function changeHistory(workspace: Locator): Locator {
    return workspace.getByRole('region', { name: 'Agent change history' });
}

function comparisonSection(workspace: Locator): Locator {
    return workspace.getByRole('region', { name: 'Agent comparison' });
}

/** Confirms the pending proposal from the workspace card and waits for the three tracks to land. */
async function confirmFromWorkspace(page: Page, workspace: Locator, baseline: number): Promise<void> {
    await approvalCard(workspace).getByRole('button', { name: WORKSPACE_CONFIRM_NAME }).click();
    await expect(trackArmButtons(page)).toHaveCount(baseline + 3, { timeout: 20_000 });
}

// Both reference hosts the campaign names have to prove the agent workspace on
// product surfaces alone. This is the standalone-browser half: the loopback
// OpenAI-compatible provider is admitted through `configureCloudProvider`, the
// proposal is raised from the chat composer, and every approval, comparison
// and revert below is driven from the workspace's own controls. The packaged
// Electron half lives in `scripts/proveDesktopAgentWorkspace.ts`.
test.describe('Agent workspace over an admitted loopback provider', () => {
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

    test('a proposal raised from chat reaches the workspace with its groups and route', async ({ page }) => {
        await proposeThreeTracks(page);
        const workspace = await openAgentWorkspace(page);

        await expect(workspace.getByRole('listbox', { name: 'Agent runs' }).getByRole('option')).not.toHaveCount(0);

        const card = approvalCard(workspace);
        await expect(card).toContainText(PROMPT);
        await expect(card.getByRole('checkbox', { name: /^Include group \d+: / }).first()).toBeVisible();
        await expect(card.getByRole('list', { name: 'Intent groups' })).toBeVisible();
        await expect(
            card.getByRole('list', { name: 'Destructive changes' }).or(card.getByText('Destructive changes: none'))
        ).toBeVisible();

        // `AgentRouteSection` names a model only under `Actual route`, which
        // `getProviderRouteView` fills from recorded provider usage; a proposal
        // still awaiting confirmation has none. What the admitted loopback
        // provider does move is the `cloud` candidate, which `createRouteCandidate`
        // admits only while `isCloudAvailable()` holds — otherwise the option is
        // listed rejected, with its reasons.
        const route = workspace.getByRole('region', { name: 'Provider route' });
        await expect(route).toContainText('cloud (remote)');
        await expect(route.getByRole('list', { name: 'Route options' }).locator('li[data-admitted="true"]')).toHaveText(
            ['cloud']
        );
    });

    test('confirming from the workspace commits the group and offers compare and revert', async ({ page }) => {
        const baseline = await proposeThreeTracks(page);
        const workspace = await openAgentWorkspace(page);
        await confirmFromWorkspace(page, workspace, baseline);

        const history = changeHistory(workspace);
        const group = history.locator('[data-state]').first();
        await expect(group).toHaveAttribute('data-state', 'applied');
        await expect(group).toHaveText('Applied');
        await expect(history.getByRole('button', { name: /^Compare agent changes / })).toBeEnabled();
        await expect(history.getByRole('button', { name: /^Revert agent changes / })).toBeEnabled();
    });

    test('the A/B toggle moves the project between before and after and ends on after', async ({ page }) => {
        const baseline = await proposeThreeTracks(page);
        const workspace = await openAgentWorkspace(page);
        await confirmFromWorkspace(page, workspace, baseline);

        await changeHistory(workspace)
            .getByRole('button', { name: /^Compare agent changes / })
            .click();

        const comparison = comparisonSection(workspace);
        const toggle = comparison.getByRole('button', { name: 'Switch comparison side' });
        await expect(toggle).toHaveText('B · after');
        await expect(toggle).toHaveAttribute('aria-pressed', 'false');
        await expect(comparison.getByRole('status')).toContainText(/^Comparing side B/);
        // The transport is stopped, so the measurement has no window to read.
        await expect(comparison).toContainText('Start playback to measure loudness');

        await toggle.click();
        await expect(toggle).toHaveText('A · before');
        await expect(toggle).toHaveAttribute('aria-pressed', 'true');
        await expect(trackArmButtons(page)).toHaveCount(baseline, { timeout: 20_000 });

        await toggle.click();
        await expect(toggle).toHaveText('B · after');
        await expect(toggle).toHaveAttribute('aria-pressed', 'false');
        await expect(trackArmButtons(page)).toHaveCount(baseline + 3, { timeout: 20_000 });

        await comparison.getByRole('button', { name: 'End comparison' }).click();
        await expect(workspace.locator('[data-ending-reason]')).toHaveAttribute('data-ending-reason', 'user-ended');
        await expect(trackArmButtons(page)).toHaveCount(baseline + 3);
    });

    test('reverting from the workspace restores the project and closes comparison off', async ({ page }) => {
        const baseline = await proposeThreeTracks(page);
        const workspace = await openAgentWorkspace(page);
        await confirmFromWorkspace(page, workspace, baseline);

        const history = changeHistory(workspace);
        await history.getByRole('button', { name: /^Revert agent changes / }).click();
        await expect(trackArmButtons(page)).toHaveCount(baseline, { timeout: 20_000 });

        const group = history.locator('[data-state]').first();
        await expect(group).toHaveAttribute('data-state', 'reverted');
        await expect(group).toHaveText('Reverted');

        const compare = history.getByRole('button', { name: /^Compare agent changes / });
        await expect(compare).toBeDisabled();
        await expect(history).toContainText('Reverted');
    });

    test('every workspace control is named and the Confirm button is reachable by keyboard', async ({ page }) => {
        const baseline = await proposeThreeTracks(page);
        const workspace = await openAgentWorkspace(page);

        const unnamed = await workspace
            .locator('button, [role="tab"], [role="combobox"], select, input[type="checkbox"]')
            .evaluateAll((elements) =>
                elements
                    .filter((element) => {
                        const label = element.getAttribute('aria-label') ?? '';
                        const described = element.getAttribute('aria-labelledby');
                        const referenced =
                            described === null ? '' : (document.getElementById(described)?.textContent ?? '');
                        const title = element.getAttribute('title') ?? '';
                        const text = element.textContent ?? '';
                        return `${label}${referenced}${title}${text}`.trim() === '';
                    })
                    .map((element) => element.outerHTML.slice(0, 120))
            );
        expect(unnamed).toEqual([]);

        await page.getByRole('listbox', { name: 'Agent runs' }).focus();
        let reachedConfirm = false;
        for (let press = 0; press < MAX_TAB_PRESSES && !reachedConfirm; press++) {
            await page.keyboard.press('Tab');
            reachedConfirm =
                (await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '')) ===
                WORKSPACE_CONFIRM_NAME;
        }
        expect(reachedConfirm).toBe(true);

        await confirmFromWorkspace(page, workspace, baseline);
        await changeHistory(workspace)
            .getByRole('button', { name: /^Compare agent changes / })
            .click();
        await expect(comparisonSection(workspace).getByRole('status')).toHaveCount(1);
    });
});
