import assert from 'node:assert/strict';

import { type Locator, type Page } from 'playwright';

import {
    addEffectTrack,
    deviceEditor,
    devicesNamed,
    exactButton,
    existingCards,
    newInstance,
    observeProofInstance,
} from './desktopEditorFamilyDrive.ts';
import {
    pausePreservesProgress,
    renderedPlayheadBeat,
    type EditorWorkspaceDrive,
    type Rectangle,
    type WorkspaceObservation,
    type WorkspaceStage,
} from './desktopEditorWorkspaceEvidence.ts';
import { launchEditorSession, quitEditorSession, readyWorkspace } from './desktopFermenterDrive.ts';
import { FermenterDriveError } from './desktopFermenterEvidence.ts';
import { STEP_TIMEOUT_MS, step } from './packagedAppSession.ts';

const TOLERANCE = 2;

function near(actual: number, expected: number): void {
    assert(Math.abs(actual - expected) <= TOLERANCE, 'rendered geometry differs from expected geometry');
}

async function box(locator: Locator): Promise<Rectangle> {
    const rectangle = await locator.boundingBox();
    assert(rectangle, 'rendered target has no rectangle');
    return rectangle;
}

async function until<Value>(read: () => Promise<Value>, accepts: (value: Value) => boolean): Promise<Value> {
    const deadline = Date.now() + STEP_TIMEOUT_MS;
    let value = await read();
    while (!accepts(value)) {
        assert(Date.now() < deadline, 'observable did not reach expected state');
        await new Promise((resolve) => setTimeout(resolve, 50));
        value = await read();
    }
    return value;
}

async function waitRectangle(dialog: Locator, expected: Partial<Rectangle>): Promise<void> {
    await until(
        () => box(dialog),
        (rectangle) =>
            (expected.x === undefined || Math.abs(rectangle.x - expected.x) <= TOLERANCE) &&
            (expected.y === undefined || Math.abs(rectangle.y - expected.y) <= TOLERANCE) &&
            (expected.width === undefined || Math.abs(rectangle.width - expected.width) <= TOLERANCE) &&
            (expected.height === undefined || Math.abs(rectangle.height - expected.height) <= TOLERANCE)
    );
}

async function fitted(dialog: Locator, row: WorkspaceObservation): Promise<Rectangle> {
    const rectangle = await box(dialog);
    // The dialog's parent is the 16px inset; its parent is the full horizontal host row.
    const host = await box(dialog.locator('../..'));
    row.rectangles.push({ host, dialog: rectangle });
    assert(rectangle.x >= host.x + 16 - TOLERANCE && rectangle.y >= host.y + 16 - TOLERANCE);
    assert(rectangle.x + rectangle.width <= host.x + host.width - 16 + TOLERANCE);
    assert(rectangle.y + rectangle.height <= host.y + host.height - 16 + TOLERANCE);
    return rectangle;
}

async function pointerDrag(target: Locator, dx: number, dy: number): Promise<void> {
    const rectangle = await box(target);
    const page = target.page();
    const x = rectangle.x + rectangle.width / 2;
    const y = rectangle.y + rectangle.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    try {
        await page.mouse.move(x + dx, y + dy, { steps: 5 });
    } finally {
        await page.mouse.up();
    }
}

function resizeHandle(dialog: Locator, axis: 'width' | 'height'): Locator {
    return dialog.getByRole('separator', { name: `Resize Fermenter ${axis}`, exact: true });
}

async function sizeAtHandle(dialog: Locator, axis: 'width' | 'height', row: WorkspaceObservation): Promise<Rectangle> {
    const handle = resizeHandle(dialog, axis);
    const rectangle = await fitted(dialog, row);
    const minimum = Number(await handle.getAttribute('aria-valuemin'));
    const maximum = Number(await handle.getAttribute('aria-valuemax'));
    const now = Number(await handle.getAttribute('aria-valuenow'));
    const host = await box(dialog.locator('../..'));
    const expectedMaximum =
        axis === 'width' ? host.x + host.width - 16 - rectangle.x : host.y + host.height - 16 - rectangle.y;
    row.values.push({ [axis]: now, minimum, maximum });
    near(maximum, expectedMaximum);
    near(minimum, Math.min(axis === 'width' ? 320 : 160, expectedMaximum));
    assert(Number.isFinite(minimum) && minimum > 0 && minimum <= maximum);
    near(now, rectangle[axis]);
    assert(now >= minimum - TOLERANCE && now <= maximum + TOLERANCE);
    return rectangle;
}

function stableOtherAxis(before: Rectangle, after: Rectangle, axis: 'width' | 'height'): void {
    near(after.x, before.x);
    near(after.y, before.y);
    near(after[axis === 'width' ? 'height' : 'width'], before[axis === 'width' ? 'height' : 'width']);
}

async function keyboardBound(
    dialog: Locator,
    axis: 'width' | 'height',
    key: 'Home' | 'End',
    row: WorkspaceObservation
): Promise<void> {
    const handle = resizeHandle(dialog, axis);
    const before = await box(dialog);
    const expected = Number(await handle.getAttribute(key === 'Home' ? 'aria-valuemin' : 'aria-valuemax'));
    await handle.press(key);
    await until(
        () => box(dialog),
        (value) => Math.abs(value[axis] - expected) <= TOLERANCE
    );
    const after = await sizeAtHandle(dialog, axis, row);
    near(after[axis], expected);
    stableOtherAxis(before, after, axis);
}

async function minimumSize(dialog: Locator, row: WorkspaceObservation): Promise<void> {
    await keyboardBound(dialog, 'width', 'Home', row);
    await keyboardBound(dialog, 'height', 'Home', row);
}

async function pointerResize(dialog: Locator, row: WorkspaceObservation): Promise<void> {
    await minimumSize(dialog, row);
    for (const axis of ['width', 'height'] as const) {
        const before = await box(dialog);
        const delta = axis === 'width' ? 73 : 47;
        await pointerDrag(resizeHandle(dialog, axis), axis === 'width' ? delta : 0, axis === 'height' ? delta : 0);
        await waitRectangle(dialog, { [axis]: before[axis] + delta });
        const after = await sizeAtHandle(dialog, axis, row);
        near(after[axis], before[axis] + delta);
        stableOtherAxis(before, after, axis);
        await pointerDrag(resizeHandle(dialog, axis), axis === 'width' ? 2000 : 0, axis === 'height' ? 2000 : 0);
        await waitRectangle(dialog, { [axis]: Number(await resizeHandle(dialog, axis).getAttribute('aria-valuemax')) });
        const maximum = await sizeAtHandle(dialog, axis, row);
        near(maximum[axis], Number(await resizeHandle(dialog, axis).getAttribute('aria-valuemax')));
        stableOtherAxis(after, maximum, axis);
        await pointerDrag(resizeHandle(dialog, axis), axis === 'width' ? -2000 : 0, axis === 'height' ? -2000 : 0);
        await waitRectangle(dialog, { [axis]: Number(await resizeHandle(dialog, axis).getAttribute('aria-valuemin')) });
        const minimum = await sizeAtHandle(dialog, axis, row);
        near(minimum[axis], Number(await resizeHandle(dialog, axis).getAttribute('aria-valuemin')));
        stableOtherAxis(after, minimum, axis);
    }
}

async function keyboardResize(dialog: Locator, row: WorkspaceObservation): Promise<void> {
    for (const axis of ['width', 'height'] as const) {
        await keyboardBound(dialog, axis, 'Home', row);
        const before = await box(dialog);
        await resizeHandle(dialog, axis).press(axis === 'width' ? 'ArrowRight' : 'ArrowDown');
        await waitRectangle(dialog, { [axis]: before[axis] + 10 });
        const grown = await sizeAtHandle(dialog, axis, row);
        near(grown[axis], before[axis] + 10);
        stableOtherAxis(before, grown, axis);
        await resizeHandle(dialog, axis).press(axis === 'width' ? 'ArrowLeft' : 'ArrowUp');
        await waitRectangle(dialog, { [axis]: before[axis] });
        near((await sizeAtHandle(dialog, axis, row))[axis], before[axis]);
        await keyboardBound(dialog, axis, 'End', row);
        const end = await box(dialog);
        await resizeHandle(dialog, axis).press(axis === 'width' ? 'ArrowRight' : 'ArrowDown');
        near((await sizeAtHandle(dialog, axis, row))[axis], end[axis]);
        await keyboardBound(dialog, axis, 'Home', row);
        await resizeHandle(dialog, axis).press(axis === 'width' ? 'ArrowLeft' : 'ArrowUp');
        await waitRectangle(dialog, { [axis]: before[axis] });
        near((await sizeAtHandle(dialog, axis, row))[axis], before[axis]);
    }
}

async function titleDrag(dialog: Locator, row: WorkspaceObservation): Promise<void> {
    const title = exactButton(dialog, 'Move Fermenter panel');
    for (const [dx, dy] of [
        [61, 43],
        [-23, -17],
    ] as const) {
        const before = await box(dialog);
        await pointerDrag(title, dx, dy);
        await waitRectangle(dialog, { x: before.x + dx, y: before.y + dy });
        const after = await fitted(dialog, row);
        near(after.x, before.x + dx);
        near(after.y, before.y + dy);
        near(after.width, before.width);
        near(after.height, before.height);
    }
    await pointerDrag(title, 3000, 3000);
    const host = await box(dialog.locator('../..'));
    const size = await box(dialog);
    await waitRectangle(dialog, {
        x: host.x + host.width - 16 - size.width,
        y: host.y + host.height - 16 - size.height,
    });
    const clamped = await fitted(dialog, row);
    near(clamped.x + clamped.width, host.x + host.width - 16);
    near(clamped.y + clamped.height, host.y + host.height - 16);
    await pointerDrag(title, -100, -80);
    const start = await box(title);
    const page = dialog.page();
    const x = start.x + start.width / 2;
    const y = start.y + start.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    try {
        const before = await box(dialog);
        await page.mouse.move(x + 24, y + 19, { steps: 3 });
        await waitRectangle(dialog, { x: before.x + 24, y: before.y + 19 });
        const held = await fitted(dialog, row);
        near(held.x, before.x + 24);
        near(held.y, before.y + 19);
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'visible' });
        await page.mouse.move(x + 80, y + 60, { steps: 3 });
        const inert = await dialog.evaluate(async (element) => {
            const rectangles: Rectangle[] = [];
            const started = performance.now();
            do {
                const { x, y, width, height } = element.getBoundingClientRect();
                rectangles.push({ x, y, width, height });
                await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            } while (performance.now() - started < 200);
            return rectangles;
        });
        assert(inert.length > 1);
        for (const rectangle of inert) {
            near(rectangle.x, held.x);
            near(rectangle.y, held.y);
            near(rectangle.width, held.width);
            near(rectangle.height, held.height);
        }
        const cancelled = await fitted(dialog, row);
        near(cancelled.x, held.x);
        near(cancelled.y, held.y);
        near(cancelled.width, held.width);
        near(cancelled.height, held.height);
    } finally {
        await page.mouse.up();
    }
}

async function viewport(page: Page): Promise<[number, number, number]> {
    return await page.evaluate(() => [innerWidth, innerHeight, devicePixelRatio]);
}

async function changeScale(page: Page, percent: number): Promise<void> {
    await page.getByRole('button', { name: 'Open Preferences', exact: true }).click();
    const preferences = page.getByRole('dialog', { name: 'Preferences', exact: true });
    await exactButton(preferences, 'Appearance').click();
    const slider = preferences.getByRole('slider', { name: 'UI Scale', exact: true });
    // A fresh isolated profile starts at 100%; each Arrow commits a real preference change.
    const old = Number(await slider.getAttribute('aria-valuenow'));
    assert(old === 100 || old === 125);
    const key = percent > old ? 'ArrowRight' : 'ArrowLeft';
    for (let current = old; current !== percent; current += percent > old ? 5 : -5) {
        await slider.press(key);
    }
    assert.equal(Number(await slider.getAttribute('aria-valuenow')), percent);
    await exactButton(preferences, 'Done').click();
    await preferences.waitFor({ state: 'detached' });
}

async function scaleRefit(page: Page, dialog: Locator, original: Locator, row: WorkspaceObservation): Promise<void> {
    await pointerDrag(exactButton(dialog, 'Move Fermenter panel'), -3000, -3000);
    const host = await box(dialog.locator('../..'));
    await waitRectangle(dialog, { x: host.x + 16, y: host.y + 16 });
    const corner = await fitted(dialog, row);
    near(corner.x, host.x + 16);
    near(corner.y, host.y + 16);
    await keyboardBound(dialog, 'width', 'End', row);
    await keyboardBound(dialog, 'height', 'End', row);
    const before = await viewport(page);
    row.values.push({ width: before[0], height: before[1], dpr: before[2], scale: 100 });
    const preferred = await fitted(dialog, row);
    await changeScale(page, 125);
    const scaled = await until(
        () => viewport(page),
        (value) => value[0] < before[0] - 10 && value[1] < before[1] - 10 && value[2] > before[2]
    );
    row.values.push({ width: scaled[0], height: scaled[1], dpr: scaled[2], scale: 125 });
    assert(Math.abs(scaled[2] / before[2] - 1.25) < 0.03);
    const scaledHost = await box(dialog.locator('../..'));
    await waitRectangle(dialog, { width: scaledHost.width - 32, height: scaledHost.height - 32 });
    const shrunk = await fitted(dialog, row);
    assert(shrunk.width < preferred.width && shrunk.height < preferred.height);
    await exactButton(dialog, 'Move Fermenter panel').click();
    // This real click must reach Close through the scaled renderer's hit testing.
    await exactButton(dialog, 'Close Fermenter').click();
    await dialog.waitFor({ state: 'detached' });
    await original.getByText('Fermenter', { exact: true }).click();
    await dialog.waitFor({ state: 'visible' });
    await changeScale(page, 100);
    const restored = await until(
        () => viewport(page),
        (value) =>
            Math.abs(value[0] - before[0]) < 2 &&
            Math.abs(value[1] - before[1]) < 2 &&
            Math.abs(value[2] - before[2]) < 0.02
    );
    row.values.push({ width: restored[0], height: restored[1], dpr: restored[2], scale: 100 });
    await waitRectangle(dialog, preferred);
    const after = await fitted(dialog, row);
    near(after.x, preferred.x);
    near(after.y, preferred.y);
    near(after.width, preferred.width);
    near(after.height, preferred.height);
}

async function playhead(page: Page): Promise<number> {
    const text = await page.getByTestId('transport-playhead').textContent();
    const beat = renderedPlayheadBeat(text ?? '');
    assert(beat !== null, 'missing rendered bars beats ticks');
    return beat;
}

async function heldPlayhead(page: Page, expected: number): Promise<void> {
    // Observe every animation frame for a bounded stability window, rather than one immediate reading.
    const values = await page.getByTestId('transport-playhead').evaluate(async (element) => {
        const readings: string[] = [];
        const started = performance.now();
        do {
            readings.push(element.textContent);
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        } while (performance.now() - started < 400);
        return readings;
    });
    assert(values.length > 1 && values.every((value) => value === values[0]));
    assert.equal(await playhead(page), expected);
}

async function pauseAtClick(
    page: Page,
    playback: Locator,
    advanced: number,
    samples: Record<string, number>
): Promise<number> {
    const pause = exactButton(playback, 'Pause');
    const capture = await pause.evaluateHandle((button) => {
        const witness: { readout: string | null } = { readout: null };
        function sample(): void {
            witness.readout = document.querySelector('[data-testid="transport-playhead"]')?.textContent ?? null;
        }
        // Native target capture runs before React's delegated bubble action changes transport state.
        button.addEventListener('click', sample, { capture: true, once: true });
        return { witness, cleanup: () => button.removeEventListener('click', sample, true) };
    });
    try {
        await pause.click();
        const clickReadout = await capture.evaluate(({ witness }) => witness.readout);
        const clicked = renderedPlayheadBeat(clickReadout ?? '');
        if (clicked !== null) {
            samples.pauseClick = clicked;
        }
        await exactButton(playback, 'Play').waitFor({ state: 'visible' });
        const paused = await playhead(page);
        samples.paused = paused;
        assert(pausePreservesProgress(advanced, clickReadout, paused), 'Pause did not park at its click position');
        return paused;
    } finally {
        try {
            await capture.evaluate(({ cleanup }) => cleanup());
        } finally {
            await capture.dispose();
        }
    }
}

async function transport(page: Page, dialog: Locator, original: Locator, row: WorkspaceObservation): Promise<void> {
    await minimumSize(dialog, row);
    await pointerDrag(exactButton(dialog, 'Move Fermenter panel'), 3000, 3000);
    assert.equal(
        Number(await page.getByRole('spinbutton', { name: 'Tempo BPM', exact: true }).getAttribute('aria-valuenow')),
        120
    );
    const tracks = page.getByRole('grid', { name: 'Track list', exact: true });
    const selected = tracks.locator('[data-track-id][aria-selected="true"]');
    const trackId = await selected.getAttribute('data-track-id');
    assert(trackId && /^[a-zA-Z0-9_-]{1,80}$/u.test(trackId));
    row.instanceIds.push(trackId);
    const ruler = page.getByLabel('Beat ruler', { exact: true });
    const rulerBox = await box(ruler);
    const before = await playhead(page);
    const samples: Record<string, number> = { before };
    row.values.push(samples);
    const read = async (): Promise<number> => {
        const value = await playhead(page);
        samples.current = value;
        return value;
    };
    // Fresh timeline: zero scroll and the rendered ruler's default 12 CSS pixels per beat.
    await ruler.click({ position: { x: 84, y: rulerBox.height / 2 } });
    const sought = await until(read, (value) => Math.abs(value - 7) < 0.02);
    samples.sought = sought;
    assert(Math.abs(sought - before) > 1);
    const playback = page.getByRole('group', { name: 'Playback controls', exact: true });
    await exactButton(playback, 'Play').click();
    const advancing = await until(read, (value) => value > sought + 0.25);
    const advanced = await until(read, (value) => value > advancing + 0.25);
    samples.advancing = advancing;
    samples.advanced = advanced;
    const paused = await pauseAtClick(page, playback, advanced, samples);
    await heldPlayhead(page, paused);
    await exactButton(playback, 'Stop').click();
    await until(read, (value) => value === 0);
    await heldPlayhead(page, 0);
    samples.stopped = 0;
    assert.equal(await selected.getAttribute('data-track-id'), trackId);
    await original.waitFor({ state: 'visible' });
    await dialog.waitFor({ state: 'visible' });
    // Reopening the exact surviving row identifies the same rendered instance after transport.
    await exactButton(dialog, 'Close Fermenter').click();
    await original.getByText('Fermenter', { exact: true }).click();
    await dialog.getByRole('button', { name: 'Show patch A', exact: true }).waitFor({ state: 'visible' });
    await exactButton(dialog, 'Close Fermenter').click();
    await dialog.waitFor({ state: 'detached' });
}

async function addEffect(
    browser: Locator,
    inspector: Locator,
    name: 'Crust' | 'Proof'
): Promise<{ id: string; card: Locator }> {
    const cards = devicesNamed(inspector, name);
    const before = await existingCards(cards);
    await browser.getByRole('tab', { name: 'Effects', exact: true }).click();
    await browser.getByTestId('browser-search').fill(name);
    const opener = browser.getByRole('button', { name: new RegExp(`^${name}\\b`, 'u') });
    await opener.focus();
    await opener.click();
    const id = await newInstance(cards, before);
    await deviceEditor(browser.page(), name).waitFor({ state: 'visible' });
    return { id, card: inspector.getByTestId(`device-card-${id}`) };
}

async function nestedEscape(
    page: Page,
    browser: Locator,
    inspector: Locator,
    row: WorkspaceObservation
): Promise<void> {
    await addEffectTrack(page);
    const keyboard = page.getByTestId('toggle-virtual-keyboard');
    await keyboard.click();
    assert.equal(await keyboard.getAttribute('aria-pressed'), 'true');
    const { id } = await addEffect(browser, inspector, 'Crust');
    row.instanceIds.push(id);
    const dialog = deviceEditor(page, 'Crust');
    const opener = browser.getByRole('button', { name: /^Crust\b/u });
    const trigger = dialog
        .getByRole('group', { name: 'Preset selector', exact: true })
        .getByRole('button', { expanded: false });
    await trigger.click();
    const list = page.getByRole('listbox', { name: 'Crust presets', exact: true });
    await list.waitFor({ state: 'visible' });
    const option = list.getByRole('option').first();
    await option.focus();
    await option.and(page.locator(':focus')).waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await list.waitFor({ state: 'detached' });
    await trigger.and(page.locator(':focus')).waitFor({ state: 'visible' });
    await dialog.waitFor({ state: 'visible' });
    assert.equal(await keyboard.getAttribute('aria-pressed'), 'true');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    await opener.and(page.locator(':focus')).waitFor({ state: 'visible' });
    assert.equal(await keyboard.getAttribute('aria-pressed'), 'true');
    await page.keyboard.press('Escape');
    await until(
        () => keyboard.getAttribute('aria-pressed'),
        (value) => value === 'false'
    );
    await page.getByTestId('virtual-keyboard-dock').waitFor({ state: 'detached' });
}

async function removeInstance(
    page: Page,
    browser: Locator,
    inspector: Locator,
    row: WorkspaceObservation
): Promise<void> {
    const first = await addEffect(browser, inspector, 'Proof');
    const second = await addEffect(browser, inspector, 'Proof');
    assert.notEqual(first.id, second.id);
    row.instanceIds.push(first.id, second.id);
    const dialog = deviceEditor(page, 'Proof');
    await exactButton(dialog, 'Close Proof').click();
    await dialog.waitFor({ state: 'detached' });
    await first.card.getByText('Proof', { exact: true }).click();
    await observeProofInstance(page, dialog, first.id);
    await first.card.getByRole('button', { name: 'Remove Proof', exact: true }).press('Enter');
    await first.card.waitFor({ state: 'detached' });
    await dialog.waitFor({ state: 'detached' });
    await second.card.waitFor({ state: 'visible' });
    await second.card.getByText('Proof', { exact: true }).click();
    await observeProofInstance(page, dialog, second.id);
    assert.equal(await dialog.locator(`[aria-labelledby="${first.id}-chain-order-label"]`).count(), 0);
    await exactButton(dialog, 'Close Proof').click();
    await dialog.waitFor({ state: 'detached' });
}

type ObserveStage = (name: WorkspaceStage, action: (row: WorkspaceObservation) => Promise<void>) => Promise<void>;

async function observeFermenterWorkspace(
    page: Page,
    browser: Locator,
    inspector: Locator,
    stage: ObserveStage
): Promise<void> {
    const dialog = deviceEditor(page, 'Fermenter');
    let original: Locator = devicesNamed(inspector, 'Fermenter');
    await stage('initial-placement', async (row) => {
        await browser.getByRole('tab', { name: 'Instruments', exact: true }).click();
        await browser.getByRole('button', { name: /^Fermenter\b/u }).click();
        await dialog.waitFor({ state: 'visible' });
        await original.waitFor({ state: 'visible' });
        const testId = await original.getAttribute('data-testid');
        const id = testId?.match(/^device-card-([a-zA-Z0-9_-]{1,80})$/u)?.[1];
        assert(id);
        original = inspector.getByTestId(`device-card-${id}`);
        row.instanceIds.push(id);
        const host = await box(dialog.locator('../..'));
        await waitRectangle(dialog, {
            width: Math.min(1200, host.width - 32),
            height: Math.min(760, host.height - 32),
        });
        const initial = await fitted(dialog, row);
        near(initial.width, Math.min(1200, host.width - 32));
        near(initial.height, Math.min(760, host.height - 32));
        near(initial.x, host.x + (host.width - initial.width) / 2);
        near(initial.y, host.y + (host.height - initial.height) / 2);
    });
    await stage('pointer-resize', (row) => pointerResize(dialog, row));
    await stage('keyboard-resize', (row) => keyboardResize(dialog, row));
    await stage('title-drag', (row) => titleDrag(dialog, row));
    await stage('scale-refit', (row) => scaleRefit(page, dialog, original, row));
    await stage('timeline-transport', (row) => transport(page, dialog, original, row));
}

export const driveDesktopEditorWorkspace: EditorWorkspaceDrive = async (binary, observations) => {
    const sessions: { acquired: number; allQuit: boolean } = { acquired: 0, allQuit: true };
    let observationFailed = false;
    async function stage(name: WorkspaceStage, action: (row: WorkspaceObservation) => Promise<void>): Promise<void> {
        const row = observations.stages.find((candidate) => candidate.stage === name);
        assert(row);
        row.outcome = 'failed';
        await step(name, () => action(row), 9 * STEP_TIMEOUT_MS);
        row.outcome = 'passed';
    }
    async function session(action: (page: Page, browser: Locator, inspector: Locator) => Promise<void>): Promise<void> {
        const app = await launchEditorSession(binary);
        sessions.acquired += 1;
        try {
            const { page } = app;
            page.setDefaultTimeout(STEP_TIMEOUT_MS);
            const browser = page.getByRole('complementary', { name: 'Browser panel', exact: true });
            const inspector = page.getByRole('complementary', { name: 'Inspector panel', exact: true });
            await step(
                'workspace-ready',
                () =>
                    readyWorkspace(page, browser, page.getByRole('group', { name: 'Playback controls', exact: true })),
                9 * STEP_TIMEOUT_MS
            );
            if (!(await inspector.isVisible())) {
                await page.getByRole('button', { name: 'Toggle inspector', exact: true }).click();
            }
            await action(page, browser, inspector);
        } finally {
            try {
                await quitEditorSession(app);
            } catch {
                sessions.allQuit = false;
            }
        }
    }
    const ready = observations.stages.find(({ stage: name }) => name === 'workspace-ready');
    assert(ready);
    ready.outcome = 'failed';
    try {
        await session(async (page, browser, inspector) => {
            // The ready stage passes before its dependent geometry and transport observations.
            ready.outcome = 'passed';
            await observeFermenterWorkspace(page, browser, inspector, stage);
        });
    } catch {
        observationFailed = true;
        // The failed stage remains explicit; its dependent rows remain not-reached.
        // Independent lifecycle groups below receive fresh isolated profiles.
    }
    for (const name of ['nested-escape', 'remove-instance'] as const) {
        if (!sessions.allQuit) {
            break;
        }
        const row = observations.stages.find(({ stage: stageName }) => stageName === name);
        assert(row);
        row.outcome = 'failed';
        try {
            await session(async (page, browser, inspector) => {
                await stage(name, async (observation) => {
                    if (name === 'nested-escape') {
                        await nestedEscape(page, browser, inspector, observation);
                    } else {
                        await addEffectTrack(page);
                        await removeInstance(page, browser, inspector, observation);
                    }
                });
            });
        } catch {
            observationFailed = true;
            // The failed lifecycle stage is retained; the other session remains independently observable.
        }
    }
    observations.appQuit = sessions.acquired > 0 && sessions.allQuit;
    if (sessions.acquired === 0) {
        throw new FermenterDriveError('launch-unavailable');
    }
    assert(!observationFailed, 'workspace observation failed');
};
