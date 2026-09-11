/**
 * Driving the packaged app's agent workspace through its own UI: admitting
 * the loopback provider in Preferences, streaming one explain-mode answer
 * back from it, raising a proposal from the chat composer, then confirming,
 * comparing and reverting it from the workspace's own controls.
 *
 * Nothing here reaches past a surface a musician has. The packaged renderer
 * cannot dynamic-import `/src/...` the way the browser E2E does, and the
 * preload exposes no test hook, so provider admission goes through the
 * Preferences form — which is the same `configureCloudProvider` call the
 * browser proof makes, reached the way a user reaches it.
 *
 * Split from `proveDesktopAgentWorkspace.ts` to keep that CLI under the
 * repository's per-file line budget; this file drives a live `Page`, so it is
 * not unit-testable without Playwright. The pure parts the CLI owns — argument
 * parsing, the verdict, the record — carry their own spec.
 */

import { type Locator, type Page } from 'playwright';

import {
    dismissAlphaNotice,
    dismissOnboardingTour,
    openNewProjectFromLaunchScreen,
    waitForWorkspaceOrLaunchScreen,
} from './desktopLatencyLaunch.ts';
import { type LoopbackOpenAiProvider } from './loopbackOpenAiProvider.ts';
import { step, STEP_TIMEOUT_MS } from './packagedAppSession.ts';

/** How long a project mutation the agent pipeline commits has to land before the step reports what it saw instead. */
const PROJECT_CHANGE_TIMEOUT_MS = 20_000;

/** The proposal round trips through the admitted provider, so it is allowed longer than a plain UI step. */
const PROPOSAL_TIMEOUT_MS = 30_000;

/** `AgentWorkspace.tsx` — the bottom-dock surface's own root, already carried by the shipped renderer. */
const AGENT_WORKSPACE_SELECTOR = '[data-testid="agent-workspace"]';

/** `AgentApprovalSection.tsx` names the card's commit control; the chat panel's own Confirm reads plain "Confirm". */
const WORKSPACE_CONFIRM_NAME = 'Confirm agent actions';

/** The multi-action fast path: enough actions to force a confirmation proposal rather than a direct apply. */
const PROMPT = 'create 3 audio tracks';

/** Explain mode has no local fast path for this, so the answer can only come back over the admitted endpoint. */
const EXPLAIN_PROMPT = 'What does this project sound like?';

/**
 * Which half of the run a step belongs to. `launch` steps happen before
 * anything in the workspace is driven, so their failure leaves nothing to
 * claim; `workspace` steps are the ones a verdict is about.
 */
export type ProofPhase = 'launch' | 'workspace';

export type ProofStep = { name: string; phase: ProofPhase; ok: boolean; observed: string };

/** Raised once a step has already recorded what it saw, so the driver stops without reporting the failure twice. */
export class ProofStepFailed extends Error {
    constructor(stepName: string) {
        super(`the step "${stepName}" did not hold`);
        this.name = 'ProofStepFailed';
    }
}

/**
 * Runs one named step, recording what it observed either way. A step that
 * throws records the failure's own message as its observation, so the record
 * names the step and what was seen rather than only that something failed.
 */
async function recordStep(
    steps: ProofStep[],
    phase: ProofPhase,
    name: string,
    run: () => Promise<string>,
    timeoutMs: number = STEP_TIMEOUT_MS
): Promise<void> {
    try {
        const observed = await step(name, run, timeoutMs);
        steps.push({ name, phase, ok: true, observed });
    } catch (error) {
        steps.push({ name, phase, ok: false, observed: error instanceof Error ? error.message : String(error) });
        throw new ProofStepFailed(name);
    }
}

function agentWorkspace(page: Page): Locator {
    return page.locator(AGENT_WORKSPACE_SELECTOR);
}

function trackArmButtons(page: Page): Locator {
    return page
        .getByRole('grid', { name: /Track list/i })
        .first()
        .getByRole('button', { name: /^Arm / });
}

/** Polls the arm-button count rather than asserting once: the confirmed batch runs through the action pipeline. */
async function waitForTrackCount(page: Page, expected: number): Promise<string> {
    const arms = trackArmButtons(page);
    const deadline = Date.now() + PROJECT_CHANGE_TIMEOUT_MS;
    let seen = await arms.count();
    while (Date.now() < deadline) {
        if (seen === expected) {
            return `${String(seen)} armable tracks`;
        }
        await page.waitForTimeout(250);
        seen = await arms.count();
    }
    throw new Error(`expected ${String(expected)} armable tracks, saw ${String(seen)}`);
}

/**
 * Admits the loopback endpoint through the Preferences form, in the order the
 * browser proof's own use-case calls make: the provider is configured first
 * and the backend preference is switched to `cloud` only once the section
 * reports the endpoint configured, so the preference is never set against a
 * provider that does not exist yet.
 */
async function admitProviderThroughPreferences(page: Page, provider: LoopbackOpenAiProvider): Promise<string> {
    await page.locator('[aria-label="Open Preferences"]').click({ timeout: STEP_TIMEOUT_MS });
    const dialog = page.getByRole('dialog', { name: 'Preferences' });
    await dialog.getByRole('button', { name: 'AI', exact: true }).click({ timeout: STEP_TIMEOUT_MS });

    await dialog.getByLabel('Hosted AI provider').selectOption('openai-compatible');
    await dialog.getByLabel('Hosted AI model').fill(provider.model);
    await dialog.getByLabel('OpenAI-compatible base URL').fill(provider.baseUrl);
    await dialog.getByLabel('OpenAI-compatible authentication').selectOption('none');
    await dialog.getByRole('button', { name: 'Connect', exact: true }).click({ timeout: STEP_TIMEOUT_MS });

    const configured = dialog.getByText(`Configured: OpenAI-compatible / ${provider.model}`, { exact: false });
    await configured.waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });

    await dialog.getByLabel('AI execution backend').selectOption('cloud');
    await dialog.getByRole('button', { name: 'Done', exact: true }).click({ timeout: STEP_TIMEOUT_MS });
    await dialog.waitFor({ state: 'detached', timeout: STEP_TIMEOUT_MS });

    return `cloud backend on ${provider.baseUrl} with model ${provider.model}`;
}

/** The chat panel starts closed, and its composer is the only surface either prompt is sent from. */
async function openChatComposer(page: Page): Promise<Locator> {
    const composer = page.locator('[aria-label="Chat message input"]');
    if ((await composer.count()) === 0) {
        await page.locator('[aria-label="Toggle AI chat panel"]').click({ timeout: STEP_TIMEOUT_MS });
    }
    await composer.waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
    return composer;
}

/**
 * Admission itself is a local store write, and the apply-mode prompt below is
 * resolved by the compound fast path before any provider is called — so
 * without this step nothing in the run would reach the endpoint, and the
 * packaged `connect-src` policy and the desktop hosted-provider branch would
 * go unexercised. Explain mode has no fast path: the reply in the chat log is
 * the endpoint's own, and the served request count says so from the other end.
 */
async function streamChatAnswer(page: Page, provider: LoopbackOpenAiProvider): Promise<string> {
    const composer = await openChatComposer(page);
    await page.locator('[aria-label="Agent execution mode"]').selectOption('explain');

    await composer.fill(EXPLAIN_PROMPT);
    await composer.press('Enter');
    await page
        .getByRole('log', { name: 'Chat conversation' })
        .filter({ hasText: provider.reply })
        .waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });

    const served = provider.completionRequests.length;
    if (served === 0) {
        throw new Error(`the chat log shows the reply but the endpoint served completionRequests=${String(served)}`);
    }
    return `completionRequests=${String(served)}; reply streamed`;
}

/** Sends the multi-action prompt in apply mode; returns the pre-prompt track count. */
async function proposeThreeTracks(page: Page): Promise<number> {
    const composer = await openChatComposer(page);

    await page.locator('[aria-label="Agent execution mode"]').selectOption('apply');
    const baseline = await trackArmButtons(page).count();

    await composer.fill(PROMPT);
    await composer.press('Enter');
    await page
        .getByRole('button', { name: 'Confirm' })
        .first()
        .waitFor({ state: 'visible', timeout: PROPOSAL_TIMEOUT_MS });

    return baseline;
}

/** The bottom dock starts closed, and the Agent tab only exists while it is open. */
async function openAgentWorkspace(page: Page): Promise<string> {
    const tablist = page.locator('[role="tablist"][aria-label="Bottom dock"]');
    if ((await tablist.count()) === 0) {
        await page.locator('[aria-label="Toggle bottom dock"]').click({ timeout: STEP_TIMEOUT_MS });
    }
    await tablist.getByRole('tab', { name: 'Agent', exact: true }).click({ timeout: STEP_TIMEOUT_MS });
    await agentWorkspace(page).waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
    return 'the Agent bottom tab shows the workspace';
}

function comparisonToggle(page: Page): Locator {
    return agentWorkspace(page).locator('[aria-label="Switch comparison side"]');
}

/** Clicks the A/B toggle and waits for the side it settles on, which is what the project state follows. */
async function toggleComparisonTo(page: Page, side: 'A' | 'B', expectedTracks: number): Promise<string> {
    const toggle = comparisonToggle(page);
    await toggle.click({ timeout: STEP_TIMEOUT_MS });
    const deadline = Date.now() + PROJECT_CHANGE_TIMEOUT_MS;
    while (Date.now() < deadline) {
        if ((await toggle.getAttribute('data-side')) === side) {
            return `${await waitForTrackCount(page, expectedTracks)} on side ${side}`;
        }
        await page.waitForTimeout(250);
    }
    throw new Error(`the toggle never reported side ${side}; it reads "${(await toggle.textContent()) ?? ''}"`);
}

/**
 * Getting the packaged app from a cold profile to a project that can be
 * driven. Everything here runs before the workspace is touched, so these
 * steps are the `launch` phase: their failure leaves the run with nothing to
 * claim about the workspace either way.
 */
async function recordLaunchSteps(steps: ProofStep[], page: Page): Promise<void> {
    // Two waits with a `STEP_TIMEOUT_MS` budget each — the same two the
    // latency harness bounds separately — so the step that merges them gets
    // both budgets rather than cutting the second one short.
    await recordStep(
        steps,
        'launch',
        'wait for the workspace or the launch screen',
        async () => {
            const startedAt = await waitForWorkspaceOrLaunchScreen(page, STEP_TIMEOUT_MS);
            if (startedAt === 'launch-screen') {
                await openNewProjectFromLaunchScreen(page, STEP_TIMEOUT_MS);
            }
            return `started at the ${startedAt}`;
        },
        2 * STEP_TIMEOUT_MS
    );

    await recordStep(steps, 'launch', 'dismiss the alpha notice', async () => {
        await dismissAlphaNotice(page, STEP_TIMEOUT_MS);
        return 'the alpha notice is gone';
    });

    // `dismissOnboardingTour` settles on the browser panel's Effects button
    // when the tour never appears, so the panel has to be showing before it is
    // asked — the same order the latency harness uses.
    await recordStep(steps, 'launch', 'show the browser panel', async () => {
        const panel = page.locator('[aria-label="Browser panel"]');
        if ((await panel.count()) === 0) {
            await page.locator('[aria-label="Toggle browser"]').click({ timeout: STEP_TIMEOUT_MS });
        }
        await panel.first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
        return 'the browser panel is visible';
    });

    await recordStep(steps, 'launch', 'dismiss the onboarding tour', async () => {
        await dismissOnboardingTour(page, STEP_TIMEOUT_MS);
        return 'the onboarding tour is gone';
    });
}

/**
 * Drives the whole proof and returns every step it took, in order, whether or
 * not the run held. A step that fails stops the drive: the steps after it
 * would be reading a project the failed step already left in an unknown
 * state, and a record of those readings would claim more than it measured.
 */
export async function driveAgentWorkspaceProof(page: Page, provider: LoopbackOpenAiProvider): Promise<ProofStep[]> {
    const steps: ProofStep[] = [];
    let baseline = 0;

    try {
        await recordLaunchSteps(steps, page);

        await recordStep(steps, 'workspace', 'admit the loopback provider through Preferences', () =>
            admitProviderThroughPreferences(page, provider)
        );

        await recordStep(
            steps,
            'workspace',
            'stream a chat answer from the admitted loopback endpoint',
            () => streamChatAnswer(page, provider),
            2 * STEP_TIMEOUT_MS
        );

        await recordStep(
            steps,
            'workspace',
            'propose three audio tracks from the chat composer',
            async () => {
                baseline = await proposeThreeTracks(page);
                return `proposal pending against ${String(baseline)} existing tracks`;
            },
            PROPOSAL_TIMEOUT_MS + STEP_TIMEOUT_MS
        );

        await recordStep(steps, 'workspace', 'open the agent workspace', () => openAgentWorkspace(page));

        await recordStep(
            steps,
            'workspace',
            'confirm the proposal from the workspace',
            async () => {
                await agentWorkspace(page)
                    .locator(`[aria-label="${WORKSPACE_CONFIRM_NAME}"]`)
                    .click({ timeout: STEP_TIMEOUT_MS });
                return waitForTrackCount(page, baseline + 3);
            },
            PROJECT_CHANGE_TIMEOUT_MS + STEP_TIMEOUT_MS
        );

        await recordStep(steps, 'workspace', 'start the A/B comparison from the change history', async () => {
            await agentWorkspace(page)
                .locator('button[data-compare-group-id]')
                .first()
                .click({ timeout: STEP_TIMEOUT_MS });
            await comparisonToggle(page).waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
            return `comparison open on side ${(await comparisonToggle(page).getAttribute('data-side')) ?? 'unknown'}`;
        });

        await recordStep(
            steps,
            'workspace',
            'toggle the comparison to A (before)',
            () => toggleComparisonTo(page, 'A', baseline),
            PROJECT_CHANGE_TIMEOUT_MS + STEP_TIMEOUT_MS
        );

        await recordStep(
            steps,
            'workspace',
            'toggle the comparison back to B (after)',
            () => toggleComparisonTo(page, 'B', baseline + 3),
            PROJECT_CHANGE_TIMEOUT_MS + STEP_TIMEOUT_MS
        );

        await recordStep(steps, 'workspace', 'end the comparison', async () => {
            await agentWorkspace(page).locator('[aria-label="End comparison"]').click({ timeout: STEP_TIMEOUT_MS });
            const ending = agentWorkspace(page).locator('[data-ending-reason]');
            await ending.waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
            const reason = await ending.getAttribute('data-ending-reason');
            if (reason !== 'user-ended') {
                throw new Error(`the comparison ended as "${reason ?? 'unknown'}", not "user-ended"`);
            }
            return `${await waitForTrackCount(page, baseline + 3)} after a user-ended comparison`;
        });

        await recordStep(
            steps,
            'workspace',
            'revert the change from the workspace',
            async () => {
                await agentWorkspace(page)
                    .locator('[aria-label^="Revert agent changes"]')
                    .first()
                    .click({ timeout: STEP_TIMEOUT_MS });
                return waitForTrackCount(page, baseline);
            },
            PROJECT_CHANGE_TIMEOUT_MS + STEP_TIMEOUT_MS
        );
    } catch (error) {
        if (!(error instanceof ProofStepFailed)) {
            throw error;
        }
    }

    return steps;
}
