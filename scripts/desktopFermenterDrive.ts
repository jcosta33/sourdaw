import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type Locator, type Page } from 'playwright';

import { emptyDiagnostics } from './desktopLatencyDiagnostics.ts';
import {
    dismissAlphaNotice,
    dismissOnboardingTour,
    openNewProjectFromLaunchScreen,
    waitForWorkspaceOrLaunchScreen,
} from './desktopLatencyLaunch.ts';
import { launchPackagedApp, removeProfileDir, step, STEP_TIMEOUT_MS, type PackagedApp } from './packagedAppSession.ts';
import { FermenterDriveError, type FermenterDrive } from './desktopFermenterEvidence.ts';

async function readyWorkspace(page: Page, browser: Locator, playback: Locator): Promise<void> {
    const startedAt = await waitForWorkspaceOrLaunchScreen(page, STEP_TIMEOUT_MS);
    if (startedAt === 'launch-screen') {
        await openNewProjectFromLaunchScreen(page, STEP_TIMEOUT_MS);
    }
    await dismissAlphaNotice(page, STEP_TIMEOUT_MS);
    if (!(await browser.isVisible())) {
        await page.getByRole('button', { name: 'Toggle browser', exact: true }).click();
    }
    await browser.waitFor({ state: 'visible' });
    await dismissOnboardingTour(page, STEP_TIMEOUT_MS);
    await playback.waitFor({ state: 'visible' });
}

async function openFermenter(page: Page, browser: Locator, card: Locator, editor: Locator): Promise<void> {
    await browser.getByRole('tab', { name: 'Instruments', exact: true }).click();
    await card.focus();
    await card.click();
    await editor.waitFor({ state: 'visible' });
    assert.equal(await editor.getAttribute('aria-modal'), 'false');
    await editor.getByRole('button', { name: 'Move Fermenter panel', exact: true }).waitFor({ state: 'visible' });
    const inspector = page.getByRole('complementary', { name: 'Inspector panel', exact: true });
    await inspector
        .locator('[data-testid^="device-card-"]')
        .filter({ has: page.getByText('Fermenter', { exact: true }) })
        .waitFor({ state: 'visible' });
    assert(await editor.evaluate((element) => element === document.activeElement));
}

async function useTransport(playback: Locator, editor: Locator): Promise<void> {
    const play = playback.getByRole('button', { name: 'Play', exact: true });
    await play.click();
    await playback.getByRole('button', { name: 'Pause', exact: true }).waitFor({ state: 'visible' });
    assert(await editor.isVisible());
    await playback.getByRole('button', { name: 'Stop', exact: true }).click();
    await play.waitFor({ state: 'visible' });
    assert(await editor.isVisible());
}

async function closeFermenter(card: Locator, editor: Locator): Promise<void> {
    await editor.getByRole('button', { name: 'Close Fermenter', exact: true }).click();
    await editor.waitFor({ state: 'detached' });
    await card.and(card.page().locator(':focus')).waitFor({ state: 'visible' });
}

async function observe(
    failure: 'workspace-not-ready' | 'dialog-open-failed' | 'transport-failed' | 'dialog-close-failed',
    action: () => Promise<void>,
    timeoutMs: number
): Promise<void> {
    try {
        await step(failure, action, timeoutMs);
    } catch {
        throw new FermenterDriveError(failure);
    }
}

async function launch(binary: string): Promise<PackagedApp> {
    let profile: string | undefined;
    try {
        profile = mkdtempSync(join(tmpdir(), 'sourdaw-fermenter-'));
        return await launchPackagedApp(binary, profile, emptyDiagnostics());
    } catch {
        if (profile !== undefined) {
            removeProfileDir(profile);
        }
        throw new FermenterDriveError('launch-unavailable');
    }
}

async function quit(app: PackagedApp): Promise<void> {
    try {
        await app.quit();
    } catch {
        throw new FermenterDriveError('quit-failed');
    }
}

export const driveDesktopFermenter: FermenterDrive = async (binary, report) => {
    const app = await launch(binary);
    try {
        const { page } = app;
        page.setDefaultTimeout(STEP_TIMEOUT_MS);
        const browser = page.getByRole('complementary', { name: 'Browser panel', exact: true });
        const playback = page.getByRole('group', { name: 'Playback controls', exact: true });
        const card = browser.getByRole('button', { name: /^Fermenter\b/u });
        const editor = page.getByRole('dialog', { name: 'Fermenter', exact: true, includeHidden: true });

        await observe('workspace-not-ready', () => readyWorkspace(page, browser, playback), 9 * STEP_TIMEOUT_MS);
        report('project-ready');
        await observe('dialog-open-failed', () => openFermenter(page, browser, card, editor), 6 * STEP_TIMEOUT_MS);
        report('dialog-open-and-focused');
        await observe('transport-failed', () => useTransport(playback, editor), 5 * STEP_TIMEOUT_MS);
        report('transport-play-stop');
        await observe('dialog-close-failed', () => closeFermenter(card, editor), 3 * STEP_TIMEOUT_MS);
        report('dialog-closed-and-opener-focused');
    } finally {
        await quit(app);
    }
    report('app-quit');
};
