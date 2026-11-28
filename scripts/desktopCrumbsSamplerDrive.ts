import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { observeReopenedWorkspace } from './desktopCrumbsSamplerReopen.ts';
import { measureCrumbsWindow } from './desktopCrumbsSamplerSignal.ts';
import { readCrumbsSnapshot } from './desktopCrumbsSamplerSnapshot.ts';
import { deviceEditor, devicesNamed } from './desktopEditorFamilyDrive.ts';
import { renderedPlayheadBeat } from './desktopEditorWorkspaceEvidence.ts';
import { launchEditorSession, readyWorkspace } from './desktopFermenterDrive.ts';
import { blackHoleCaptureAllowsHiddenDefault, cardDeviceId } from './desktopGrandBouleAuditionDrive.ts';
import { captureAdmissionFailure, captureBlackHole } from './desktopGrandBouleCapture.ts';
import { STEP_TIMEOUT_MS, step } from './packagedAppSession.ts';

import type { CrumbsSamplerObservations, CrumbsTrial } from './desktopCrumbsSamplerEvidence.ts';
import type { Locator, Page } from 'playwright';

const FILE = 'c15-isolated-crumbs-431hz.wav';
const RATE = 44100;
const DEVICE = 'BlackHole 2ch';
type Capture = Awaited<ReturnType<typeof captureBlackHole>>;

class CaptureWindowUnavailable extends Error {}

export function isCaptureWindowFailure(error: unknown): boolean {
    return (
        error instanceof Error &&
        /(?:^|: )(?:capture-clock-unavailable|capture-clock-stale|capture-message-invalid|capture-window-invalid)(?:\n|$)/u.test(
            error.message
        )
    );
}

function wav(seconds: number, tone: (frame: number) => number): Buffer {
    const frames = RATE * seconds;
    const data = Buffer.alloc(44 + frames * 2);
    data.write('RIFF', 0);
    data.writeUInt32LE(data.length - 8, 4);
    data.write('WAVEfmt ', 8);
    data.writeUInt32LE(16, 16);
    data.writeUInt16LE(1, 20);
    data.writeUInt16LE(1, 22);
    data.writeUInt32LE(RATE, 24);
    data.writeUInt32LE(RATE * 2, 28);
    data.writeUInt16LE(2, 32);
    data.writeUInt16LE(16, 34);
    data.write('data', 36);
    data.writeUInt32LE(frames * 2, 40);
    for (let i = 0; i < frames; i++) {
        const edge = Math.min(1, i / 500, (frames - 1 - i) / 500);
        data.writeInt16LE(Math.round(edge * tone(i)), 44 + i * 2);
    }
    return data;
}

async function captureWindow(observer: Capture, observations: CrumbsSamplerObservations, start = 0, count = 32768) {
    try {
        return measureCrumbsWindow(
            await observer.evaluate((c, args) => c.sample(args.start, args.count), { start, count })
        );
    } catch (error) {
        if (!isCaptureWindowFailure(error)) {
            throw error;
        }
        observations.unavailable = 'capture-clock-or-input-unavailable';
        throw new CaptureWindowUnavailable(observations.unavailable);
    }
}

async function until(read: () => Promise<boolean>): Promise<void> {
    const deadline = Date.now() + STEP_TIMEOUT_MS;
    while (!(await read())) {
        assert(Date.now() < deadline, 'Crumbs observation timed out');
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
}

async function dropSample(page: Page, panel: Locator, file: string, bytes: number): Promise<boolean> {
    await panel.evaluate((element) => {
        if (!(element instanceof HTMLElement)) {
            throw new TypeError('invalid sampler panel');
        }
        element.addEventListener(
            'drop',
            (event) => {
                element.setAttribute(
                    'data-crumbs-drop',
                    JSON.stringify({
                        trusted: event.isTrusted,
                        name: event.dataTransfer?.files[0]?.name,
                        size: event.dataTransfer?.files[0]?.size,
                    })
                );
            },
            { once: true, capture: true }
        );
    });
    const box = await panel.boundingBox();
    assert(box);
    const x = Math.floor(box.x + box.width / 2),
        y = Math.floor(box.y + Math.min(150, box.height / 2));
    assert(
        await panel.evaluate((element, point) => element.contains(document.elementFromPoint(point.x, point.y)), {
            x,
            y,
        })
    );
    const session = await page.context().newCDPSession(page);
    const data = { items: [], files: [file], dragOperationsMask: 1 };
    try {
        for (const type of ['dragEnter', 'dragOver', 'drop'] as const) {
            await session.send('Input.dispatchDragEvent', { type, x, y, data });
        }
    } finally {
        await session.detach();
    }
    const observed: unknown = JSON.parse((await panel.getAttribute('data-crumbs-drop')) ?? 'null');
    assert.deepEqual(observed, { trusted: true, name: FILE, size: bytes });
    await panel.getByText(FILE, { exact: true }).waitFor();
    return true;
}

async function seekBeyondControl(page: Page): Promise<number> {
    const ruler = page.getByLabel('Beat ruler', { exact: true });
    const box = await ruler.boundingBox();
    assert(box);
    await ruler.click({ position: { x: 264, y: box.height / 2 } });
    const text = (await page.getByRole('button', { name: /^Playhead position/u }).textContent()) ?? '';
    const match = /^bars\s*(\d+)\s*\.\s*(\d+)\s*\.\s*(\d+)$/iu.exec(text.trim());
    assert(match);
    const beat = (Number(match[1]) - 1) * 4 + Number(match[2]) - 1;
    assert(beat > 16);
    return beat;
}

async function trial(
    page: Page,
    observer: Capture,
    observations: CrumbsSamplerObservations,
    kind: CrumbsTrial['kind']
): Promise<CrumbsTrial> {
    const panel = deviceEditor(page, 'Sampler').getByRole('region', { name: 'Crumbs controls', exact: true });
    const pad = panel.getByRole('button', { name: /^Pad 1(?: \(empty\))?$/u });
    await pad.scrollIntoViewIfNeeded();
    const box = await pad.boundingBox();
    assert(box);
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    assert(await pad.evaluate((el, p) => el.contains(document.elementFromPoint(p.x, p.y)), point));
    const baseline = await captureWindow(observer, observations);
    const receipt = await pad.evaluateHandle((element, receiver) => {
        const state: { frame: number | null; down: boolean; up: boolean } = { frame: null, down: false, up: false };
        element.addEventListener(
            'pointerdown',
            (event) => {
                state.down = event.isTrusted;
                state.frame = receiver.frame();
            },
            { once: true, capture: true }
        );
        element.addEventListener(
            'pointerup',
            (event) => {
                state.up = event.isTrusted;
            },
            { once: true, capture: true }
        );
        return state;
    }, observer);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    try {
        const pressFrame = await receipt.evaluate((state) => state.frame);
        assert(pressFrame !== null);
        const positive = await captureWindow(observer, observations, pressFrame + 4096);
        const before = renderedPlayheadBeat((await page.getByTestId('transport-playhead').textContent()) ?? '');
        if (kind === 'release') {
            await page.mouse.up();
        }
        const actionFrame = await observer.evaluate((c) => c.frame());
        const late = await captureWindow(observer, observations, positive.firstFrame + positive.frames, 98304);
        const after = renderedPlayheadBeat((await page.getByTestId('transport-playhead').textContent()) ?? '');
        if (kind === 'held') {
            await page.mouse.up();
        }
        const events = await receipt.jsonValue();
        return {
            kind,
            baseline,
            positive,
            late,
            pressFrame,
            actionFrame,
            trustedDown: events.down,
            trustedUp: events.up,
            nativeRunning:
                (await page.locator('span[title^="Engine: "]').getAttribute('title'))?.startsWith(
                    'Engine: native running'
                ) === true,
            advancing: before !== null && after !== null && after > before,
        };
    } finally {
        await page.mouse.up();
        await receipt.dispose();
    }
}

async function openCapture(page: Page, observations: CrumbsSamplerObservations): Promise<Capture | null> {
    let hidden: boolean;
    try {
        const output = execFileSync('SwitchAudioSource', ['-c', '-t', 'output'], {
            encoding: 'utf8',
            timeout: 5000,
        }).trim();
        assert.equal(output, DEVICE);
        hidden = blackHoleCaptureAllowsHiddenDefault();
        observations.output = output;
    } catch {
        observations.unavailable = 'exact-blackhole-device-unavailable';
        return null;
    }
    try {
        const capture = await step(
            'admit BlackHole media capture',
            () => captureBlackHole(page, hidden),
            STEP_TIMEOUT_MS
        );
        observations.input = await capture.evaluate((c) => c.input);
        assert.equal(observations.input, DEVICE);
        return capture;
    } catch (error) {
        observations.unavailable = captureAdmissionFailure(error);
        return null;
    }
}

async function startTrials(
    page: Page,
    observer: Capture,
    observations: CrumbsSamplerObservations,
    phase: 'fresh' | 'reopened'
): Promise<void> {
    const playback = page.getByRole('group', { name: 'Playback controls', exact: true });
    await playback.getByRole('button', { name: 'Play', exact: true }).click();
    try {
        await playback.getByRole('button', { name: 'Pause', exact: true }).waitFor();
        await until(
            async () =>
                (await page.locator('span[title^="Engine: "]').getAttribute('title'))?.startsWith(
                    'Engine: native running'
                ) === true
        );
        observations.trials[phase].push(await trial(page, observer, observations, 'held'));
        observations.trials[phase].push(await trial(page, observer, observations, 'release'));
    } finally {
        await playback.getByRole('button', { name: 'Stop', exact: true }).click();
    }
}

async function importControl(
    page: Page,
    track: Locator,
    observer: Capture,
    observations: CrumbsSamplerObservations
): Promise<void> {
    const control = wav(40, (i) => {
        const hz = i < RATE * 8 ? 619 : 220;
        return 3000 * Math.sin((2 * Math.PI * hz * i) / RATE);
    });
    await track.click({ position: { x: 8, y: 12 }, button: 'right' });
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('menuitem', { name: /Import Audio/i }).click();
    await (await chooser).setFiles({ name: 'c15-control.wav', mimeType: 'audio/wav', buffer: control });
    const inspector = page.getByRole('complementary', { name: 'Inspector panel', exact: true });
    await inspector.getByText(/^Clips \(1\)$/iu).waitFor();
    await inspector.getByText(/^c15-control(?:\.wav)?$/iu).waitFor();
    const playback = page.getByRole('group', { name: 'Playback controls', exact: true });
    await playback.getByRole('button', { name: 'Play', exact: true }).click();
    await playback.getByRole('button', { name: 'Pause', exact: true }).waitFor();
    await until(
        async () =>
            (await page.locator('span[title^="Engine: "]').getAttribute('title'))?.startsWith(
                'Engine: native running'
            ) === true
    );
    observations.control619 = await captureWindow(observer, observations);
    assert(observations.control619.tone619 >= 0.00001, 'control tone missing');
    await playback.getByRole('button', { name: 'Stop', exact: true }).click();
}

async function saveFixture(page: Page, editor: Locator, observations: CrumbsSamplerObservations): Promise<void> {
    const knob = editor.getByRole('slider', { name: 'Cutoff', exact: true });
    await knob.press('ArrowLeft');
    assert.equal(Number(await knob.getAttribute('aria-valuenow')), 19990);
    const dirty = page.locator('[title="Unsaved changes"]');
    await dirty.waitFor();
    await page.keyboard.press('Meta+K');
    const input = page.getByTestId('command-palette-input');
    await input.fill('Save Project');
    await page
        .getByRole('option', { name: /Save Project/iu })
        .first()
        .waitFor();
    await input.press('Enter');
    await dirty.waitFor({ state: 'detached', timeout: 15000 });
    observations.savedClean = true;
    assert(observations.trackId && observations.deviceId);
    const saved = await readCrumbsSnapshot(page, observations.trackId, observations.deviceId);
    observations.savedSnapshot = saved.snapshot;
    observations.savedHeads = saved.heads;
}

async function drivePhase(
    binary: string,
    observations: CrumbsSamplerObservations,
    phase: 'fresh' | 'reopened',
    file: string,
    sample: Buffer
): Promise<void> {
    const app = await launchEditorSession(binary);
    let observer: Capture | null = null;
    try {
        const { page } = app;
        page.setDefaultTimeout(STEP_TIMEOUT_MS);
        const browser = page.getByRole('complementary', { name: 'Browser panel', exact: true });
        const playback = page.getByRole('group', { name: 'Playback controls', exact: true });
        if (phase === 'fresh') {
            await readyWorkspace(page, browser, playback);
        } else {
            await step(
                'observe reopened workspace and binary',
                () => observeReopenedWorkspace(page, observations),
                27000
            );
        }
        observer = await openCapture(page, observations);
        if (!observer) {
            return;
        }
        const trackList = page.getByRole('grid', { name: 'Track list', exact: true });
        const inspector = page.getByRole('complementary', { name: 'Inspector panel', exact: true });
        const editor = deviceEditor(page, 'Sampler');
        let track: Locator;
        if (phase === 'fresh') {
            await browser.getByRole('tab', { name: 'Instruments', exact: true }).click();
            await browser
                .getByRole('button', { name: /^Crumbs\b/u })
                .filter({ hasText: 'Crumbs' })
                .click();
            await editor.getByText('Ready', { exact: true }).waitFor();
            track = trackList.locator('[data-track-id][aria-selected="true"]');
            observations.trackId = await track.getAttribute('data-track-id');
            assert(observations.trackId);
            observations.deviceId = cardDeviceId(await devicesNamed(inspector, 'Sampler').getAttribute('data-testid'));
            const panel = editor.getByRole('region', { name: 'Crumbs controls', exact: true });
            observations.trustedDrop = await dropSample(page, panel, file, sample.length);
            await panel.getByText('Drum', { exact: true }).click();
            await editor.getByRole('button', { name: 'Close Sampler', exact: true }).press('Enter');
            await importControl(page, track, observer, observations);
        } else {
            assert(observations.trackId && observations.deviceId);
            track = trackList.locator(`[data-track-id="${observations.trackId}"]`);
            await track.click({ position: { x: 8, y: 12 } });
            await track.and(page.locator('[aria-selected="true"]')).waitFor();
            if (!(await inspector.isVisible())) {
                await page.getByRole('button', { name: 'Toggle inspector', exact: true }).click();
            }
            const back = inspector.getByRole('button', { name: 'Back to track', exact: true });
            if (await back.isVisible()) {
                await back.click();
            }
            observations.reopenedTrackId = await track.getAttribute('data-track-id');
            observations.reopenedDeviceId = cardDeviceId(
                await inspector.getByTestId(`device-card-${observations.deviceId}`).getAttribute('data-testid')
            );
        }
        observations.seekBeats[phase] = await seekBeyondControl(page);
        assert(observations.deviceId);
        await inspector
            .getByTestId(`device-card-${observations.deviceId}`)
            .getByText('Sampler', { exact: true })
            .click();
        await editor.getByText('Ready', { exact: true }).waitFor();
        await editor.getByText(FILE, { exact: true }).waitFor();
        await startTrials(page, observer, observations, phase);
        if (phase === 'fresh') {
            await saveFixture(page, editor, observations);
        }
    } finally {
        try {
            if (observer) {
                await observer.evaluate((c) => c.close());
                await observer.dispose();
            }
        } finally {
            observations.quits.push(await app.quitObserved());
        }
    }
}

export async function driveDesktopCrumbsSampler(
    binary: string,
    observations: CrumbsSamplerObservations
): Promise<void> {
    const base = mkdtempSync(join(realpathSync(tmpdir()), 'sourdaw-crumbs-'));
    const namespace = join(base, '.sourdaw-native-runtime-scopes-v1');
    const scope = join(namespace, randomUUID());
    mkdirSync(scope, { recursive: true, mode: 0o700 });
    const data = join(scope, 'native', 'data');
    mkdirSync(data, { recursive: true, mode: 0o700 });
    const sample = wav(8, (i) => 2400 * Math.sin((2 * Math.PI * 431 * i) / RATE));
    const file = join(data, FILE);
    writeFileSync(file, sample, { mode: 0o600 });
    observations.sampleSha256 = createHash('sha256').update(sample).digest('hex');
    const priorScope = process.env.SOURDAW_DESKTOP_RUNTIME_SCOPE_ROOT;
    process.env.SOURDAW_DESKTOP_RUNTIME_SCOPE_ROOT = scope;
    try {
        for (const phase of ['fresh', 'reopened'] as const) {
            await drivePhase(binary, observations, phase, file, sample);
            if (observations.unavailable) {
                return;
            }
        }
    } catch (error) {
        if (!(error instanceof CaptureWindowUnavailable)) {
            throw error;
        }
    } finally {
        if (priorScope === undefined) {
            delete process.env.SOURDAW_DESKTOP_RUNTIME_SCOPE_ROOT;
        } else {
            process.env.SOURDAW_DESKTOP_RUNTIME_SCOPE_ROOT = priorScope;
        }
    }
}
