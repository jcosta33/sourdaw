import assert from 'node:assert/strict';

import { type Locator, type Page } from 'playwright';

import { type DeviceObservation, type EditorFamilyDrive } from './desktopEditorFamilyEvidence.ts';
import { launchEditorSession, quitEditorSession, readyWorkspace } from './desktopFermenterDrive.ts';
import { FermenterDriveError } from './desktopFermenterEvidence.ts';
import { STEP_TIMEOUT_MS, step } from './packagedAppSession.ts';

const ID = /^device-card-([a-zA-Z0-9_-]{1,80})$/u;

function devicesNamed(inspector: Locator, name: string): Locator {
    return inspector.getByTestId(ID).filter({ has: inspector.page().getByText(name, { exact: true }) });
}

async function newInstance(cards: Locator, before: string[]): Promise<string> {
    const exclude = before.map((testId) => `:not([data-testid="${testId}"])`).join('');
    let added = cards;
    if (exclude) {
        added = cards.and(cards.page().locator(exclude));
    }
    await added.waitFor({ state: 'visible' });
    const testId = await added.getAttribute('data-testid');
    const id = testId?.match(ID)?.[1];
    assert(id, 'missing generated device identity');
    return id;
}

async function existingCards(cards: Locator): Promise<string[]> {
    return await cards.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-testid') ?? ''));
}

function exactButton(surface: Locator, name: string): Locator {
    return surface.getByRole('button', { name, exact: true });
}

async function browserCard(browser: Locator, row: DeviceObservation): Promise<Locator> {
    const search = browser.getByTestId('browser-search');
    if (row.navigation === 'instrument') {
        await browser.getByRole('tab', { name: 'Instruments', exact: true }).click();
        await search.fill('');
    } else {
        await browser.getByRole('tab', { name: 'Effects', exact: true }).click();
        if (row.navigation === 'midi-effect') {
            await search.fill('');
            await browser.getByRole('button', { name: /^MIDI FX\b/u }).click();
        } else {
            await search.fill(row.device);
        }
    }
    return browser.getByRole('button', { name: new RegExp(`^${row.device}\\b`, 'u') }).filter({
        has: browser.page().getByText(row.device, { exact: true }),
    });
}

function deviceEditor(page: Page, name: string): Locator {
    return page
        .getByRole('dialog', { name, exact: true, includeHidden: true })
        .and(page.locator('[data-device-editor]'));
}

async function observeShell(page: Page, dialog: Locator): Promise<void> {
    await dialog.waitFor({ state: 'visible' });
    assert.equal(await dialog.getAttribute('aria-modal'), 'false');
    assert.equal(await page.locator('[data-device-editor]').count(), 1);
    await dialog.and(page.locator(':focus')).waitFor({ state: 'visible' });
}

function renderedControl(body: Locator, row: DeviceObservation): Locator {
    const { editorControl: name, device } = row;
    switch (device) {
        case 'Fermenter':
        case 'Crust':
            return exactButton(body, name);
        case 'Grand Boule':
            return body.getByRole('region', { name, exact: true });
        case 'Dutch Oven':
            return body.getByRole('slider', { name, exact: true });
        case 'Scoring':
        case 'Toaster':
        case 'Levain':
        case 'Bacteria':
        case 'Grinder':
        case 'Gluten':
            return body.getByLabel(name, { exact: true });
        case 'Crumbs':
        case 'Proof':
        case 'Yeast':
            return body.getByText(name, { exact: true });
    }
}

async function observeEditor(dialog: Locator, row: DeviceObservation, instanceId: string): Promise<void> {
    const body = dialog.getByTestId('floating-device-panel-body');
    const control = renderedControl(body, row);
    if (row.device === 'Crumbs') {
        const unavailable = body.getByText('Engine unavailable', { exact: true });
        await control.or(unavailable).waitFor({ state: 'visible' });
        if (await unavailable.isVisible()) {
            row.failure = 'sampler-engine-unavailable';
            throw new Error(row.failure);
        }
    }
    await control.waitFor({ state: 'visible' });
    if (row.device === 'Toaster') {
        assert.equal(await control.getAttribute('id'), `toaster-view-${instanceId}`);
    }
}

async function openFromBrowser(
    browser: Locator,
    cards: Locator,
    row: DeviceObservation
): Promise<{ opener: Locator; instanceId: string }> {
    row.failure = 'browser-route-unavailable';
    const opener = await browserCard(browser, row);
    row.failure = 'card-unavailable';
    await opener.waitFor({ state: 'visible' });
    row.phase = 'card';
    row.failure = 'card-disabled';
    assert(await opener.isEnabled());
    row.failure = 'open-action-failed';
    const before = await existingCards(cards);
    await opener.focus();
    await opener.click();
    row.failure = 'instance-missing-or-ambiguous';
    const instanceId = await newInstance(cards, before);
    row.instanceId = instanceId;
    row.phase = 'instance';
    return { opener, instanceId };
}

async function observeDevice(browser: Locator, inspector: Locator, row: DeviceObservation): Promise<void> {
    const page = browser.page();
    const cards = devicesNamed(inspector, row.dialog);
    const dialog = deviceEditor(page, row.dialog);
    const { opener, instanceId } = await openFromBrowser(browser, cards, row);
    row.failure = 'dialog-missing-or-incorrect';
    await observeShell(page, dialog);
    row.phase = 'dialog';
    row.failure = 'editor-control-missing-or-incorrect';
    await observeEditor(dialog, row, instanceId);
    row.phase = 'editor';
    row.failure = 'close-action-failed';
    // Use the real close button by keyboard. Pointer reachability is a C13 check.
    await exactButton(dialog, `Close ${row.dialog}`).press('Enter');
    await page.locator('[data-device-editor]').waitFor({ state: 'detached' });
    row.phase = 'closed';
    row.failure = 'opener-focus-not-restored';
    await opener.and(page.locator(':focus')).waitFor({ state: 'visible' });
    row.phase = 'focus-returned';
    row.failure = null;
}

async function dismissFailedEditor(page: Page): Promise<void> {
    const editor = page.locator('[data-device-editor]');
    if (await editor.count()) {
        await editor.press('Escape');
        await editor.waitFor({ state: 'detached' });
    }
}

async function addEffectTrack(page: Page): Promise<void> {
    await page.keyboard.press('Meta+k');
    await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
    await page.getByRole('option', { name: 'Add MIDI Track' }).click();
    const tracks = page.getByRole('grid', { name: 'Track list', exact: true });
    await tracks
        .locator('[data-track-id][aria-selected="true"]')
        .getByText(/^MIDI \d+$/u)
        .waitFor({ state: 'visible' });
}

async function observeProofInstance(page: Page, dialog: Locator, id: string): Promise<void> {
    await observeShell(page, dialog);
    const depth = dialog.getByRole('group', { name: 'Effect control detail', exact: true });
    await exactButton(depth, 'route').press('Enter');
    const chain = dialog.getByRole('group', { name: 'Signal Chain Order', exact: true });
    await chain.waitFor({ state: 'visible' });
    assert.equal(await chain.getAttribute('aria-labelledby'), `${id}-chain-order-label`);
}

async function observeLifecycle(
    page: Page,
    browser: Locator,
    inspector: Locator,
    observations: Parameters<EditorFamilyDrive>[1]
): Promise<void> {
    const first = observations.devices.find(({ device }) => device === 'Proof');
    if (!first || first.phase !== 'focus-returned' || first.instanceId === null) {
        return;
    }
    const cards = devicesNamed(inspector, 'Proof');
    const firstCard = cards.and(page.getByTestId(`device-card-${first.instanceId}`));
    const dialog = deviceEditor(page, 'Proof');
    await firstCard.getByText('Proof', { exact: true }).click();
    await observeProofInstance(page, dialog, first.instanceId);
    const lifecycle: NonNullable<typeof observations.lifecycle> = {
        firstInstanceId: first.instanceId,
        secondInstanceId: null,
        selectionClosed: false,
        originalReopened: false,
        phase: 'original-open',
    };
    observations.lifecycle = lifecycle;
    const second = { ...first, instanceId: null };
    const { instanceId: secondInstanceId } = await openFromBrowser(browser, cards, second);
    assert(secondInstanceId !== first.instanceId);
    // The old Route content must leave before the second instance's actual control is read.
    await dialog.locator(`[aria-labelledby="${first.instanceId}-chain-order-label"]`).waitFor({ state: 'detached' });
    await observeProofInstance(page, dialog, secondInstanceId);
    lifecycle.secondInstanceId = secondInstanceId;
    lifecycle.phase = 'replacement-open';
    const tracks = page.getByRole('grid', { name: 'Track list', exact: true }).locator('[data-track-id]');
    const selected = tracks.and(page.locator('[aria-selected="true"]'));
    const oldTrack = await selected.getAttribute('data-track-id');
    assert(oldTrack && /^[a-zA-Z0-9_-]{1,80}$/u.test(oldTrack));
    await selected.press('ArrowUp');
    await page.locator('[data-device-editor]').waitFor({ state: 'detached' });
    await selected.and(page.locator(`:not([data-track-id="${oldTrack}"])`)).waitFor({ state: 'visible' });
    lifecycle.selectionClosed = true;
    lifecycle.phase = 'selection-changed';
    await selected.press('ArrowDown');
    await selected.and(page.locator(`[data-track-id="${oldTrack}"]`)).waitFor({ state: 'visible' });
    await firstCard.getByText('Proof', { exact: true }).click();
    await observeProofInstance(page, dialog, first.instanceId);
    lifecycle.originalReopened = true;
    lifecycle.phase = 'original-reopened';
    await exactButton(dialog, 'Close Proof').press('Enter');
    await page.locator('[data-device-editor]').waitFor({ state: 'detached' });
    lifecycle.phase = 'closed';
}

export const driveDesktopEditorFamily: EditorFamilyDrive = async (binary, observations) => {
    const app = await launchEditorSession(binary);
    try {
        const { page } = app;
        page.setDefaultTimeout(STEP_TIMEOUT_MS);
        const browser = page.getByRole('complementary', { name: 'Browser panel', exact: true });
        const inspector = page.getByRole('complementary', { name: 'Inspector panel', exact: true });
        const playback = page.getByRole('group', { name: 'Playback controls', exact: true });
        try {
            await step('workspace-ready', () => readyWorkspace(page, browser, playback), 9 * STEP_TIMEOUT_MS);
            if (!(await inspector.isVisible())) {
                await page.getByRole('button', { name: 'Toggle inspector', exact: true }).click();
            }
        } catch {
            throw new FermenterDriveError('workspace-not-ready');
        }
        for (const row of observations.devices) {
            if (row.device === 'Dutch Oven') {
                await addEffectTrack(page);
            }
            try {
                await observeDevice(browser, inspector, row);
            } catch {
                await dismissFailedEditor(page);
            }
        }
        try {
            await observeLifecycle(page, browser, inspector, observations);
        } catch {
            await dismissFailedEditor(page);
        }
    } finally {
        await quitEditorSession(app);
        observations.appQuit = true;
    }
};
