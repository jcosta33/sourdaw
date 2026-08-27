import { expect, test, type Locator, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace, wait_for_workspace_ready } from './e2eUtils';

const MODIFIER = process.platform === 'darwin' ? 'Meta' : 'Control';
const OFFLINE_IDLE_WINDOW_MS = 500;

test.use({ serviceWorkers: 'block' });

function dirtyIndicator(page: Page) {
    return page.getByTitle('Unsaved changes');
}

function trackList(page: Page) {
    return page.getByRole('grid', { name: /Track list/i }).first();
}

function isLoopbackEndpoint(url: URL): boolean {
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
}

async function blockExternalRequests(page: Page): Promise<() => Promise<void>> {
    const unexpectedEndpoints = { requests: [] as string[], webSockets: [] as string[] };
    await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (isLoopbackEndpoint(url)) {
            await route.continue();
            return;
        }
        unexpectedEndpoints.requests.push(url.toString());
        await route.abort('blockedbyclient');
    });
    await page.routeWebSocket('**/*', async (webSocket) => {
        const url = new URL(webSocket.url());
        if (isLoopbackEndpoint(url)) {
            webSocket.connectToServer();
            return;
        }
        unexpectedEndpoints.webSockets.push(url.toString());
        await webSocket.close({ code: 1008, reason: 'External network blocked' });
    });
    return async () => {
        await page.waitForTimeout(OFFLINE_IDLE_WINDOW_MS);
        expect(unexpectedEndpoints, 'offline smoke blocked external runtime endpoints').toEqual({
            requests: [],
            webSockets: [],
        });
    };
}

type AudioContextTestControl = {
    resumeState: () => Promise<string>;
    suspend: () => Promise<string | undefined>;
};

async function observeAudioContextResumeState(page: Page): Promise<AudioContextTestControl> {
    await page.addInitScript(() => {
        const nativeResume = AudioContext.prototype.resume;
        const nativeCreateGain = AudioContext.prototype.createGain;
        let observedAudioContext: AudioContext | undefined;
        AudioContext.prototype.createGain = function (this: AudioContext): GainNode {
            observedAudioContext = this;
            return nativeCreateGain.call(this);
        };
        AudioContext.prototype.resume = async function (this: AudioContext): Promise<void> {
            observedAudioContext = this;
            await nativeResume.call(this);
            document.documentElement.dataset.audioContextResumeState = this.state;
        };
        document.addEventListener('sourdaw-test-read-audio-context-state', () => {
            document.documentElement.dataset.audioContextResumeState = observedAudioContext?.state ?? 'missing';
            document.dispatchEvent(new Event('sourdaw-test-audio-context-state-read'));
        });
        document.addEventListener('sourdaw-test-suspend-audio-context', () => {
            void (async () => {
                if (!observedAudioContext) {
                    document.documentElement.dataset.audioContextResumeState = 'missing';
                } else {
                    await observedAudioContext.suspend();
                    document.documentElement.dataset.audioContextResumeState = observedAudioContext.state;
                }
                document.dispatchEvent(new Event('sourdaw-test-audio-context-suspended'));
            })();
        });
    });
    return {
        resumeState: () =>
            page.evaluate(
                () =>
                    new Promise<string>((resolve) => {
                        document.addEventListener(
                            'sourdaw-test-audio-context-state-read',
                            () => resolve(document.documentElement.dataset.audioContextResumeState ?? 'missing'),
                            { once: true }
                        );
                        document.dispatchEvent(new Event('sourdaw-test-read-audio-context-state'));
                    })
            ),
        suspend: () =>
            page.evaluate(
                () =>
                    new Promise<string | undefined>((resolve) => {
                        document.addEventListener(
                            'sourdaw-test-audio-context-suspended',
                            () => resolve(document.documentElement.dataset.audioContextResumeState),
                            { once: true }
                        );
                        document.dispatchEvent(new Event('sourdaw-test-suspend-audio-context'));
                    })
            ),
    };
}

type ScheduledOscillatorTestControl = {
    count: () => Promise<number>;
    reset: () => Promise<void>;
};

async function observeScheduledOscillatorCount(page: Page): Promise<ScheduledOscillatorTestControl> {
    await page.addInitScript(() => {
        const nativeStart = OscillatorNode.prototype.start;
        OscillatorNode.prototype.start = function (
            this: OscillatorNode,
            ...args: Parameters<OscillatorNode['start']>
        ): void {
            const count = Number(document.documentElement.dataset.scheduledOscillatorCount ?? '0');
            document.documentElement.dataset.scheduledOscillatorCount = String(count + 1);
            nativeStart.apply(this, args);
        };
        document.addEventListener('sourdaw-test-reset-scheduled-oscillator-count', () => {
            document.documentElement.dataset.scheduledOscillatorCount = '0';
        });
    });
    return {
        count: async () =>
            Number(await page.evaluate(() => document.documentElement.dataset.scheduledOscillatorCount ?? '0')),
        reset: () =>
            page.evaluate(() => {
                document.dispatchEvent(new Event('sourdaw-test-reset-scheduled-oscillator-count'));
            }),
    };
}

async function openNewProject(page: Page): Promise<() => Promise<void>> {
    const assertOffline = await blockExternalRequests(page);
    await setupWorkspace(page);
    await launch_new_project(page);
    return assertOffline;
}

async function addMidiTrack(page: Page): Promise<void> {
    const list = trackList(page);
    const before = await list.getByRole('row').count();
    await page.keyboard.press(`${MODIFIER}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
    await page.getByRole('option', { name: 'Add MIDI Track' }).click();
    await expect.poll(() => list.getByRole('row').count()).toBeGreaterThan(before);
    await list.getByText('MIDI', { exact: true }).click();
}

async function midiLaneY(page: Page): Promise<number> {
    const timeline = page.getByLabel('Timeline editor surface');
    const muteBox = await page.getByRole('button', { name: 'Mute MIDI' }).boundingBox();
    const timelineBox = await timeline.boundingBox();
    if (!muteBox || !timelineBox) {
        throw new Error('Mute MIDI or timeline surface has no bounding box');
    }
    return Math.min(Math.max(muteBox.y - timelineBox.y + muteBox.height / 2, 8), timelineBox.height - 8);
}

async function openBottomTab(page: Page, name: string): Promise<void> {
    const dock = page.getByRole('button', { name: 'Toggle bottom dock' });
    if ((await dock.getAttribute('aria-pressed')) !== 'true') {
        await dock.click();
    }
    const tab = page.getByRole('tablist', { name: 'Bottom dock' }).getByRole('tab', { name, exact: true });
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
}

async function createPlayableMidiClip(page: Page): Promise<Locator> {
    await addMidiTrack(page);
    const timeline = page.getByLabel('Timeline editor surface');
    await expect(timeline).toBeVisible();
    const y = await midiLaneY(page);
    await timeline.click({ button: 'right', position: { x: 300, y } });
    await page.getByRole('menuitem', { name: /Add Clip Here/i }).click();
    await expect(page.getByText(/New midi clip/i).first()).toBeVisible();
    await timeline.dblclick({ position: { x: 300, y } });
    const pianoRoll = page.getByLabel('Piano roll editor');
    await expect(pianoRoll).toBeVisible();
    await openBottomTab(page, 'Editor');

    const paint = page.getByRole('button', { name: 'Toggle paint mode' });
    if ((await paint.getAttribute('aria-pressed')) !== 'true') {
        await paint.click();
    }
    await pianoRoll.click({ position: { x: 200, y: 130 } });
    await expect(page.getByTestId('selected-clip-note-count')).toHaveText('1 note');
    return pianoRoll;
}

async function renameProject(page: Page, name: string): Promise<void> {
    await page.getByRole('button', { name: 'Untitled Project' }).click();
    const projectNameInput = page.locator('input:focus');
    await projectNameInput.fill(name);
    await projectNameInput.press('Enter');
}

async function openSavedProjectInFreshPage(page: Page, name: string) {
    const appRootUrl = new URL('/', page.url()).toString();
    const reopenedPage = await page.context().newPage();
    const assertOffline = await blockExternalRequests(reopenedPage);
    await reopenedPage.goto(appRootUrl);
    await wait_for_workspace_ready(reopenedPage);
    await reopenedPage.getByRole('button', { name: 'Project menu' }).click();
    await reopenedPage.getByRole('menuitem', { name }).click();
    return { assertOffline, page: reopenedPage };
}

test.describe('Offline project smoke', () => {
    test('launches a new project into the workspace', async ({ page }) => {
        const assertOffline = await openNewProject(page);

        await expect(page.getByRole('group', { name: 'Playback controls' })).toBeVisible();
        await expect(page.getByText('Add your first track')).toBeVisible();
        await assertOffline();
    });

    test('saves and reopens an edited project', async ({ page }) => {
        const assertOffline = await openNewProject(page);
        await expect(dirtyIndicator(page)).toHaveCount(0);

        await renameProject(page, 'Smoke Persistence');

        await addMidiTrack(page);
        await expect(dirtyIndicator(page)).toBeVisible();

        await page.keyboard.press(`${MODIFIER}+s`);
        await expect(dirtyIndicator(page)).toHaveCount(0);

        const reopened = await openSavedProjectInFreshPage(page, 'Smoke Persistence');
        try {
            await expect(reopened.page.getByRole('button', { name: 'Smoke Persistence' })).toBeVisible();
            await expect(trackList(reopened.page).getByText('MIDI', { exact: true })).toBeVisible();
            await reopened.assertOffline();
        } finally {
            await reopened.page.close();
        }
        await assertOffline();
    });

    test('advances the playhead during playback and restores it on stop', async ({ page }) => {
        const audioContext = await observeAudioContextResumeState(page);
        const scheduledOscillators = await observeScheduledOscillatorCount(page);
        const assertOffline = await openNewProject(page);
        await createPlayableMidiClip(page);

        const playbackControls = page.getByRole('group', { name: 'Playback controls' });
        const playhead = page.getByTestId('transport-playhead');
        const playheadPosition = async () => (await playhead.innerText()).replaceAll(/\s/g, '');
        const initialPosition = await playheadPosition();
        const play = page.getByTestId('transport-play');
        await scheduledOscillators.reset();
        await expect.poll(scheduledOscillators.count).toBe(0);
        await audioContext.suspend();
        await expect.poll(audioContext.resumeState).toBe('suspended');
        await play.click();
        await expect(playbackControls.getByRole('status')).toHaveText('Playing');
        await expect(play).toHaveAccessibleName('Pause');
        await expect.poll(audioContext.resumeState).toBe('running');
        await expect.poll(scheduledOscillators.count).toBeGreaterThan(0);

        await expect.poll(playheadPosition).not.toBe(initialPosition);
        const firstAdvancedPosition = await playheadPosition();
        await expect.poll(playheadPosition).not.toBe(firstAdvancedPosition);

        await page.getByTestId('transport-stop').click();
        await expect(playbackControls.getByRole('status')).toHaveText('Stopped');
        await expect(play).toHaveAccessibleName('Play');
        await expect.poll(playheadPosition).toBe(initialPosition);
        const stoppedPosition = await playheadPosition();
        await page.waitForTimeout(250);
        await expect(playheadPosition()).resolves.toBe(stoppedPosition);
        await assertOffline();
    });

    test('undo restores durable project truth before its track edit', async ({ page }) => {
        const assertOffline = await openNewProject(page);
        await renameProject(page, 'Smoke Undo Persistence');

        await addMidiTrack(page);
        const midiTrack = trackList(page).getByText('MIDI', { exact: true });
        await expect(midiTrack).toBeVisible();

        const undo = page.getByRole('button', { name: 'Undo', exact: true });
        await expect(undo).toBeEnabled();
        await undo.click();
        await expect(midiTrack).toHaveCount(0);
        await expect(page.getByText('Add your first track')).toBeVisible();

        await page.keyboard.press(`${MODIFIER}+s`);
        await expect(dirtyIndicator(page)).toHaveCount(0);

        const reopened = await openSavedProjectInFreshPage(page, 'Smoke Undo Persistence');
        try {
            await expect(reopened.page.getByRole('button', { name: 'Smoke Undo Persistence' })).toBeVisible();
            await expect(trackList(reopened.page).getByText('MIDI', { exact: true })).toHaveCount(0);
            await expect(reopened.page.getByText('Add your first track')).toBeVisible();
            await reopened.assertOffline();
        } finally {
            await reopened.page.close();
        }
        await assertOffline();
    });
});
