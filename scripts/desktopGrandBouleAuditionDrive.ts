import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

import { type Locator, type Page } from 'playwright';

import { deviceEditor, devicesNamed } from './desktopEditorFamilyDrive.ts';
import { renderedPlayheadBeat } from './desktopEditorWorkspaceEvidence.ts';
import { launchEditorSession, quitEditorSession, readyWorkspace } from './desktopFermenterDrive.ts';
import {
    measureSignalWindow,
    type AuditionObservations,
    type AuditionTrial,
} from './desktopGrandBouleAuditionEvidence.ts';
import { captureBlackHole } from './desktopGrandBouleCapture.ts';
import { STEP_TIMEOUT_MS, step } from './packagedAppSession.ts';

const DEVICE = 'BlackHole 2ch';
function audio(args: string[]): string {
    return execFileSync('SwitchAudioSource', args, { encoding: 'utf8', timeout: 5000 }).trim();
}
export type InputSelection = { prior: string | null; changed: boolean };
type AudioCommand = (args: string[]) => string;

export function admitBlackHoleInput(selection: InputSelection, run: AudioCommand = audio): void {
    selection.prior = run(['-c', '-t', 'input']);
    if (selection.prior !== DEVICE) {
        run(['-t', 'input', '-s', DEVICE]);
        selection.changed = true;
    }
    assert.equal(run(['-c', '-t', 'input']), DEVICE);
}

export function restoreBlackHoleInput(selection: InputSelection, run: AudioCommand = audio): void {
    if (!selection.changed || selection.prior === null) {
        return;
    }
    if (run(['-c', '-t', 'input']) !== DEVICE) {
        return;
    }
    run(['-t', 'input', '-s', selection.prior]);
    selection.changed = false;
}

export function cardDeviceId(testId: string | null): string {
    const deviceId = (testId ?? '').match(/^device-card-([a-zA-Z0-9_-]{1,80})$/u)?.[1];
    assert(deviceId, 'missing generated Grand Boule device identity');
    return deviceId;
}

async function until(read: () => Promise<boolean>): Promise<void> {
    const deadline = Date.now() + STEP_TIMEOUT_MS;
    while (!(await read())) {
        assert(Date.now() < deadline, 'rendered audition witness timed out');
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
}
async function text(locator: Locator, expected: string): Promise<void> {
    await until(async () => (await locator.textContent()) === expected);
}
async function fixture(page: Page, observations: AuditionObservations): Promise<Locator> {
    const browser = page.getByRole('complementary', { name: 'Browser panel', exact: true });
    const playback = page.getByRole('group', { name: 'Playback controls', exact: true });
    await readyWorkspace(page, browser, playback);
    await browser.getByRole('tab', { name: 'Instruments', exact: true }).click();
    await browser.getByRole('button', { name: /^Grand Boule\b/u }).click();
    const editor = deviceEditor(page, 'Grand Boule');
    await editor.waitFor({ state: 'visible' });
    const selected = page
        .getByRole('grid', { name: 'Track list', exact: true })
        .locator('[data-track-id][aria-selected="true"]');
    observations.trackId = await selected.getAttribute('data-track-id');
    const card = devicesNamed(page.getByRole('complementary', { name: 'Inspector panel', exact: true }), 'Grand Boule');
    observations.deviceId = cardDeviceId(await card.getAttribute('data-testid'));
    await editor.getByRole('button', { name: 'Close Grand Boule', exact: true }).press('Enter');
    await editor.waitFor({ state: 'detached' });
    const timeline = page.getByLabel('Timeline editor surface', { exact: true });
    // Fresh one-track timeline; create at beat zero and open the actual clip.
    const trackBox = await selected.boundingBox();
    const timelineBox = await timeline.boundingBox();
    assert(trackBox && timelineBox);
    const trackY = trackBox.y + trackBox.height / 2 - timelineBox.y;
    assert(trackY > 0 && trackY < timelineBox.height);
    await timeline.click({ button: 'right', position: { x: 4, y: trackY } });
    await page.getByRole('menuitem', { name: /Add Clip Here/i }).click();
    await timeline.click({ position: { x: 4, y: trackY } });
    const trim = page.getByRole('slider', { name: 'Trim clip end', exact: true });
    await trim.press('End');
    assert(Number(await trim.getAttribute('aria-valuenow')) >= 256);
    await timeline.dblclick({ position: { x: 4, y: trackY } });
    const roll = page.getByLabel('Piano roll editor', { exact: true });
    await roll.waitFor({ state: 'visible' });
    const paint = page.getByRole('button', { name: 'Toggle paint mode', exact: true });
    assert.equal(await paint.getAttribute('aria-pressed'), 'false');
    const hover = page.getByRole('button', { name: 'Toggle note hover preview', exact: true });
    if ((await hover.getAttribute('aria-pressed')) === 'true') {
        await hover.click();
    }
    const snap = page.getByRole('button', { name: '1/4', exact: true });
    await snap.click();
    assert.equal(await snap.getAttribute('aria-pressed'), 'true');
    const zoom = page.getByRole('slider', { name: 'Horizontal zoom', exact: true });
    await zoom.press('Home');
    await zoom.press('ArrowRight');
    assert.equal(await zoom.getAttribute('aria-valuenow'), '50');
    const count = page.getByTestId('selected-clip-note-count');
    await text(count, '0 notes');
    // The DOM pitch rail supplies the y coordinate; no project-store write or injected note.
    const rail = page.getByText('A3', { exact: true });
    await rail.scrollIntoViewIfNeeded();
    const row = await rail.boundingBox();
    const canvas = await roll.boundingBox();
    assert(row && canvas);
    const y = row.y + row.height / 2;
    const startX = canvas.x + 3;
    assert(await roll.evaluate((el, p) => document.elementFromPoint(p.x, p.y) === el, { x: startX, y }));
    await paint.click();
    await page.mouse.click(startX, y);
    await text(count, '1 note');
    await paint.click();
    // Fifty-percent zoom gives 20 CSS pixels per beat; both resize points must hit the real canvas.
    for (const x of [canvas.x + 18, canvas.x + 318]) {
        assert(
            await roll.evaluate((element, point) => document.elementFromPoint(point.x, point.y) === element, { x, y })
        );
    }
    await page.mouse.move(canvas.x + 18, y);
    await page.mouse.down();
    try {
        await page.mouse.move(canvas.x + 318, y, { steps: 8 });
    } finally {
        await page.mouse.up();
    }
    await text(count, '1 note');
    // Sustained A3 admission below independently checks the edited duration in actual output.
    await page
        .getByRole('complementary', { name: 'Inspector panel', exact: true })
        .getByRole('button', { name: 'Back to track', exact: true })
        .click();
    await card
        .and(page.getByTestId(`device-card-${observations.deviceId}`))
        .getByText('Grand Boule', { exact: true })
        .click();
    await editor.waitFor({ state: 'visible' });
    await editor.getByRole('button', { name: 'Piano keyboard', exact: true }).click();
    await editor.getByLabel('Grand Boule interactive piano', { exact: true }).waitFor({ state: 'visible' });
    return card;
}

type Capture = Awaited<ReturnType<typeof captureBlackHole>>;

async function sampleOutput(observer: Capture, observations: AuditionObservations, start = 0, count = 32768) {
    try {
        return measureSignalWindow(
            await observer.evaluate((c, window) => c.sample(window.start, window.count), { start, count })
        );
    } catch {
        observations.unavailable = 'capture-clock-or-input-unavailable';
        throw new Error(observations.unavailable);
    }
}

async function heldTrial(
    page: Page,
    observer: Capture,
    observations: AuditionObservations,
    kind: AuditionTrial['kind'],
    sentinel: AuditionTrial['scheduled']
): Promise<AuditionTrial> {
    const editor = deviceEditor(page, 'Grand Boule');
    const beat = async () => renderedPlayheadBeat((await page.getByTestId('transport-playhead').textContent()) ?? '');
    const piano = editor.getByLabel('Grand Boule interactive piano', { exact: true });
    const box = await piano.boundingBox();
    assert(box);
    const p = { x: box.x + box.width * 0.461077, y: box.y + box.height * 0.81472 };
    assert(await piano.evaluate((el, point) => document.elementFromPoint(point.x, point.y) === el, p));
    const press = await piano.evaluateHandle((element, receiver) => {
        const witness: { frame: number | null } = { frame: null };
        const listener = (): void => {
            witness.frame = receiver.frame();
        };
        element.addEventListener('pointerdown', listener, { capture: true, once: true });
        return {
            read: () => witness.frame,
            cleanup: () => element.removeEventListener('pointerdown', listener, true),
        };
    }, observer);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    try {
        const pressFrame = await press.evaluate((w) => w.read());
        assert(pressFrame !== null);
        await editor
            .getByRole('status')
            .filter({ hasText: /Playing .*C4/u })
            .waitFor({ state: 'attached' });
        const nativeBefore =
            (await page.locator('span[title^="Engine: "]').getAttribute('title'))?.startsWith(
                'Engine: native running'
            ) === true;
        const positive = await sampleOutput(observer, observations, pressFrame + 4096);
        const before = await beat();
        if (kind === 'release') {
            await page.mouse.up();
        }
        if (kind === 'close') {
            await editor.getByRole('button', { name: 'Close Grand Boule', exact: true }).press('Enter');
            await editor.waitFor({ state: 'detached' });
        }
        const actionFrame = await observer.evaluate((c) => c.frame());
        const late = await sampleOutput(observer, observations, positive.endFrame, 98304);
        const after = await beat();
        const trial: AuditionTrial = {
            kind,
            pressFrame,
            scheduled: sentinel,
            positive,
            late,
            actionFrame,
            nativeCarrier:
                nativeBefore &&
                (await page.locator('span[title^="Engine: "]').getAttribute('title'))?.startsWith(
                    'Engine: native running'
                ) === true,
            advancing: before !== null && after !== null && after > before,
        };
        return trial;
    } finally {
        try {
            await page.mouse.up();
        } finally {
            await press.evaluate((w) => w.cleanup());
            await press.dispose();
        }
    }
}
async function observeTrials(page: Page, observer: Capture, observations: AuditionObservations): Promise<void> {
    const playback = page.getByRole('group', { name: 'Playback controls', exact: true });
    const editor = deviceEditor(page, 'Grand Boule');
    const selected = page
        .getByRole('grid', { name: 'Track list', exact: true })
        .locator('[data-track-id][aria-selected="true"]');
    const beat = async () => renderedPlayheadBeat((await page.getByTestId('transport-playhead').textContent()) ?? '');
    for (const kind of ['held', 'release', 'close'] as const) {
        await playback.getByRole('button', { name: 'Stop', exact: true }).click();
        await until(async () => (await beat()) === 0);
        let quiet = await sampleOutput(observer, observations);
        for (let attempt = 0; quiet.rms > 0.0001 && attempt < 10; attempt++) {
            quiet = await sampleOutput(observer, observations);
        }
        assert(quiet.rms <= 0.0001, 'output did not settle to measured quiet');
        if (!observations.quiet) {
            observations.quiet = quiet;
        }
        if (kind === 'close') {
            // Previous normal release keeps the panel open.
            await editor.waitFor({ state: 'visible' });
        }
        assert.equal(await selected.getAttribute('data-track-id'), observations.trackId);
        await playback.getByRole('button', { name: 'Play', exact: true }).click();
        await until(async () => ((await beat()) ?? -1) > 0.25);
        const sentinel = await sampleOutput(observer, observations);
        assert(sentinel.sentinel > Math.max(0.00001, quiet.rms * 10), 'no positive scheduled A3 sentinel');
        observations.trials.push(await heldTrial(page, observer, observations, kind, sentinel));
        assert.equal(await selected.getAttribute('data-track-id'), observations.trackId);
    }
    await playback.getByRole('button', { name: 'Stop', exact: true }).click();
}

export async function driveDesktopGrandBouleAudition(
    binary: string,
    observations: AuditionObservations
): Promise<void> {
    const selection: InputSelection = { prior: null, changed: false };
    try {
        assert.equal(audio(['-c', '-t', 'output']), DEVICE);
        observations.output = DEVICE;
        assert(audio(['-a', '-t', 'input']).split('\n').includes(DEVICE));
        admitBlackHoleInput(selection);
        observations.input = DEVICE;
    } catch {
        observations.unavailable = 'exact-blackhole-device-unavailable';
    }
    if (observations.unavailable) {
        restoreBlackHoleInput(selection);
        return;
    }
    let app: Awaited<ReturnType<typeof launchEditorSession>> | undefined;
    let capture: Awaited<ReturnType<typeof captureBlackHole>> | undefined;
    try {
        app = await launchEditorSession(binary);
        const { page } = app;
        page.setDefaultTimeout(STEP_TIMEOUT_MS);
        await step(
            'ready packaged workspace',
            () =>
                readyWorkspace(
                    page,
                    page.getByRole('complementary', { name: 'Browser panel', exact: true }),
                    page.getByRole('group', { name: 'Playback controls', exact: true })
                ),
            8 * STEP_TIMEOUT_MS
        );
        try {
            assert.equal(audio(['-c', '-t', 'input']), DEVICE);
            capture = await step('admit BlackHole media capture', () => captureBlackHole(page), STEP_TIMEOUT_MS);
        } catch (error) {
            observations.unavailable =
                error instanceof Error && /NotAllowedError|Permission denied|Permission dismissed/u.test(error.message)
                    ? 'microphone-permission-denied'
                    : 'capture-bootstrap-unavailable';
            return;
        }
        const observer = capture;
        assert.equal(await observer.evaluate((c) => c.input), DEVICE);
        observations.quiet = await sampleOutput(observer, observations);
        const card = await step(
            'prepare Grand Boule UI fixture',
            () => fixture(page, observations),
            8 * STEP_TIMEOUT_MS
        );
        await observeTrials(page, observer, observations);
        await card.waitFor({ state: 'visible' });
    } finally {
        try {
            if (capture) {
                await capture.evaluate((c) => c.close());
                await capture.dispose();
            }
        } finally {
            try {
                if (app) {
                    await quitEditorSession(app);
                    observations.appQuit = true;
                }
            } finally {
                restoreBlackHoleInput(selection);
            }
        }
    }
}
