import { readFile } from 'node:fs/promises';

import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { type AppAction } from '../../src/utils/handlerContract';
import { isRecordingPassId } from '../../src/utils/recordingPassId';

import { add_midi_track, launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const LOOP_END = 4;
const PITCHES = [60, 64, 67];

type BrowserEvidence = {
    captureSink: boolean;
    sink: Array<{ frequency: number; at: number }>;
    labels: string[];
    rectangles: Array<{ x: number; y: number; width: number; height: number }>;
};

type EvidenceWindow = Window & { __midiCycleEvidence: BrowserEvidence };

/** Observational wrappers always call the original browser methods. No scheduler or voice is replaced. */
async function observeBrowserBoundaries(page: Page): Promise<void> {
    await page.context().addInitScript(() => {
        const state: BrowserEvidence = { captureSink: false, sink: [], labels: [], rectangles: [] };
        (window as EvidenceWindow).__midiCycleEvidence = state;
        Reflect.deleteProperty(window, 'showSaveFilePicker');
        const createOscillator = AudioContext.prototype.createOscillator;
        AudioContext.prototype.createOscillator = function () {
            const oscillator = createOscillator.call(this);
            const setFrequency = oscillator.frequency.setValueAtTime.bind(oscillator.frequency);
            oscillator.frequency.setValueAtTime = (value, time) => {
                if (state.captureSink) {
                    state.sink.push({ frequency: value, at: time });
                }
                return setFrequency(value, time);
            };
            return oscillator;
        };
        const drawImage = CanvasRenderingContext2D.prototype.drawImage;
        const text = CanvasRenderingContext2D.prototype.fillText;
        const rectangle = CanvasRenderingContext2D.prototype.roundRect;
        CanvasRenderingContext2D.prototype.drawImage = function (image, ...args: number[]) {
            if (this.canvas.getAttribute('aria-label') === 'Piano roll editor') {
                state.labels = [];
                state.rectangles = [];
            }
            return Reflect.apply(drawImage, this, [image, ...args]);
        };
        CanvasRenderingContext2D.prototype.fillText = function (...args) {
            if (this.canvas.getAttribute('aria-label') === 'Piano roll editor' && /^[A-G]#?-?\d$/.test(args[0])) {
                state.labels.push(args[0]);
            }
            return text.apply(this, args);
        };
        CanvasRenderingContext2D.prototype.roundRect = function (...args) {
            if (this.canvas.getAttribute('aria-label') === 'Piano roll editor' && args[3] === 14) {
                const matrix = this.getTransform();
                const bounds = this.canvas.getBoundingClientRect();
                state.rectangles.push({
                    x: bounds.x + (matrix.a * args[0] + matrix.c * args[1] + matrix.e) / devicePixelRatio,
                    y: bounds.y + (matrix.b * args[0] + matrix.d * args[1] + matrix.f) / devicePixelRatio,
                    width: Math.abs(matrix.a * args[2]) / devicePixelRatio,
                    height: Math.abs(matrix.d * args[3]) / devicePixelRatio,
                });
            }
            return rectangle.apply(this, args);
        };
    });
}

/** Fixture setup uses the same typed command boundary as application mutations. */
async function fixtureActions(page: Page, actions: AppAction[]): Promise<void> {
    await page.evaluate(async (inputs) => {
        const { executeAppAction } = await import('/src/modules/Command/useCases/index.ts');
        for (const action of inputs) {
            await executeAppAction(action);
        }
    }, actions);
}

async function snapshot(page: Page) {
    return page.evaluate(async () => {
        const { trackStore, takeLaneStore } = await import('/src/modules/Arrangement/stores/index.ts');
        const { midiStore } = await import('/src/modules/MIDI/stores/index.ts');
        const { undoHistoryStore } = await import('/src/modules/Command/stores/index.ts');
        const track = trackStore.value?.tracks.find((candidate) => candidate.kind === 'midi');
        return structuredClone({
            trackId: track?.id,
            clips: track?.clips ?? [],
            notes: track?.clips.flatMap((clip) => midiStore.value?.notesByClipId[clip.id] ?? []) ?? [],
            lane: takeLaneStore.value?.lanes.find((lane) => lane.trackId === track?.id),
            historyCount: undoHistoryStore.value?.past.length ?? 0,
        });
    });
}

async function clock(page: Page) {
    return page.evaluate(async () => {
        const { captureGestureBeat, playheadWrapCountRef, transportStore } =
            await import('/src/modules/Transport/stores/index.ts');
        return {
            beat: captureGestureBeat(),
            lap: playheadWrapCountRef.current,
            recording: transportStore.value?.isRecording,
            playing: transportStore.value?.isPlaying,
        };
    });
}

async function atBeat(page: Page, lap: number, beat: number): Promise<void> {
    await expect
        .poll(
            async () => {
                const current = await clock(page);
                if (current.lap > lap || (current.lap === lap && current.beat > beat + 0.5)) {
                    throw new Error(
                        `Missed real transport window lap ${lap}, beat ${beat}: ${JSON.stringify(current)}`
                    );
                }
                return current.lap === lap && current.beat >= beat;
            },
            { timeout: 15_000, intervals: [20] }
        )
        .toBe(true);
}

async function key(page: Page, name: string, pressed: boolean): Promise<void> {
    const keyboard = page.getByRole('application', { name: 'Virtual Piano Keyboard' });
    await expect(keyboard).toBeVisible();
    await keyboard.focus();
    if (pressed) {
        await page.keyboard.down(name);
    } else {
        await page.keyboard.up(name);
    }
}

async function command(page: Page, label: string): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    const input = page.getByPlaceholder('Type a command...', { exact: true });
    await expect(input).toBeVisible();
    await input.fill(label);
    await page.getByRole('option', { name: label, exact: true }).click();
}

async function prepare(page: Page): Promise<string> {
    await observeBrowserBoundaries(page);
    await setupWorkspace(page);
    const response = await page.request.get('/');
    expect(decodeURIComponent(response.headers()['x-sourdaw-root'] ?? '')).toBe(process.cwd());
    await launch_new_project(page);
    await add_midi_track(page);
    const trackId = (await snapshot(page)).trackId;
    expect(trackId).toBeTruthy();
    if (!trackId) {
        throw new Error('Actual Add MIDI Track UI did not create its track');
    }
    await fixtureActions(page, [
        { type: 'armTrack', payload: { trackId, armed: true } },
        { type: 'setTempo', payload: { bpm: 120 } },
        { type: 'setLoopRegion', payload: { startBeat: 0, endBeat: LOOP_END } },
        { type: 'setLoopEnabled', payload: { enabled: true } },
        { type: 'seekPlayhead', payload: { beat: 0 } },
    ]);
    await page.getByRole('button', { name: 'Toggle virtual keyboard', exact: true }).click();
    await expect(page.getByRole('application', { name: 'Virtual Piano Keyboard' })).toBeVisible();
    return trackId;
}

async function promote(page: Page, take: { id: string; name: string }, pitch: number, info: TestInfo): Promise<void> {
    const button = page.getByRole('button', { name: `Promote ${take.name} to main take`, exact: true });
    await expect(button).toBeVisible();
    await button.click();
    await expect
        .poll(async () => (await snapshot(page)).lane?.takes.find((candidate) => candidate.selected)?.id)
        .toBe(take.id);
    const label = ['C4', 'E4', 'G4'][PITCHES.indexOf(pitch)];
    await expect
        .poll(() => page.evaluate(() => [...new Set((window as EvidenceWindow).__midiCycleEvidence.labels)]))
        .toEqual([label]);
    await info.attach(`selected-${pitch}-canvas`, {
        body: await page.getByLabel('Piano roll editor').screenshot(),
        contentType: 'image/png',
    });
}

async function browserPlayback(page: Page, pitch: number): Promise<unknown> {
    await page.evaluate(() => {
        const evidence = (window as EvidenceWindow).__midiCycleEvidence;
        evidence.sink = [];
        evidence.captureSink = true;
    });
    await page.getByTestId('transport-play').click();
    // Each real Play starts its own wrap-count epoch. Observe that reset before
    // waiting for a full traversal, so a stale preceding roll cannot satisfy it.
    await expect
        .poll(
            async () => {
                const started = await clock(page);
                return started.playing === true && started.lap === 0;
            },
            { timeout: 5_000, intervals: [20] }
        )
        .toBe(true);
    await expect
        .poll(async () => (await clock(page)).lap, { timeout: 10_000, intervals: [30] })
        .toBeGreaterThanOrEqual(1);
    await page.getByTestId('transport-stop').click();
    const notes = await page.evaluate(() => {
        const evidence = (window as EvidenceWindow).__midiCycleEvidence;
        evidence.captureSink = false;
        return evidence.sink;
    });
    const pitches = [...new Set(notes.map((note) => Math.round(69 + 12 * Math.log2(note.frequency / 440))))].filter(
        (candidate) => PITCHES.includes(candidate)
    );
    expect(pitches).toEqual([pitch]);
    return notes;
}

/** Decode the downloaded product WAV and compare its fundamental energy at the three performed pitches. */
function wavPitchEnergy(bytes: Buffer): Record<number, number> {
    expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
    expect(bytes.toString('ascii', 8, 12)).toBe('WAVE');
    let channels = 0;
    let sampleRate = 0;
    let bits = 0;
    let data = Buffer.alloc(0);
    for (let offset = 12; offset + 8 <= bytes.length;) {
        const length = bytes.readUInt32LE(offset + 4);
        const start = offset + 8;
        const kind = bytes.toString('ascii', offset, offset + 4);
        if (kind === 'fmt ') {
            expect(bytes.readUInt16LE(start)).toBe(1);
            channels = bytes.readUInt16LE(start + 2);
            sampleRate = bytes.readUInt32LE(start + 4);
            bits = bytes.readUInt16LE(start + 14);
        }
        if (kind === 'data') {
            data = bytes.subarray(start, start + length);
        }
        offset = start + length + (length % 2);
    }
    expect(channels).toBeGreaterThan(0);
    expect(sampleRate).toBeGreaterThan(0);
    expect(data.length).toBeGreaterThan(0);
    expect([16, 24, 32]).toContain(bits);
    const stride = (bits / 8) * channels;
    return Object.fromEntries(
        PITCHES.map((pitch) => {
            const frequency = 440 * 2 ** ((pitch - 69) / 12);
            let real = 0;
            let imaginary = 0;
            for (let frame = 0; frame * stride + bits / 8 <= data.length; frame += 4) {
                const value = data.readIntLE(frame * stride, bits / 8) / 2 ** (bits - 1);
                const phase = (2 * Math.PI * frequency * frame) / sampleRate;
                real += value * Math.cos(phase);
                imaginary += value * Math.sin(phase);
            }
            return [pitch, real * real + imaginary * imaginary];
        })
    );
}

async function exportWav(page: Page, pitch: number, info: TestInfo): Promise<void> {
    await page.keyboard.press(`${MOD}+Shift+e`);
    const dialog = page.getByRole('dialog').filter({ hasText: /The Bakery/i });
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('export-format-wav')).toHaveAttribute('aria-checked', 'true');
    await dialog.getByRole('radio', { name: /Loop region/i }).check();
    await dialog.getByLabel('Auto-detect').uncheck();
    await dialog.getByLabel('Tail seconds').fill('0');
    const started = page.waitForEvent('download', { timeout: 90_000 });
    await page.getByTestId('export-start').click();
    const download = await started;
    expect(await download.failure()).toBeNull();
    const path = await download.path();
    if (!path) {
        throw new Error('Actual WAV export produced no retained download');
    }
    const energies = wavPitchEnergy(await readFile(path));
    expect(energies[pitch]).toBeGreaterThan(0.01);
    for (const other of PITCHES.filter((candidate) => candidate !== pitch)) {
        expect(energies[pitch]).toBeGreaterThan(energies[other] * 3);
    }
    await info.attach(`selected-${pitch}-wav`, { path, contentType: 'audio/wav' });
    await info.attach(`selected-${pitch}-pcm-energy`, {
        body: JSON.stringify(energies),
        contentType: 'application/json',
    });
    await dialog.getByRole('button', { name: 'Close Bakery' }).click();
}

test('three actual MIDI loop laps survive selection, browser playback, WAV export, editing, one recording Undo and boot hydration', async ({
    page,
    context,
}, info) => {
    test.setTimeout(300_000);
    await prepare(page);
    const historyBefore = (await snapshot(page)).historyCount;
    await page.getByTestId('transport-record').click();
    await expect.poll(async () => (await clock(page)).recording).toBe(true);
    await atBeat(page, 0, 2.5);
    await key(page, 'a', true);
    await atBeat(page, 1, 0.4);
    await key(page, 'a', false);
    await atBeat(page, 1, 0.8);
    await key(page, 'd', true);
    await atBeat(page, 1, 1.8);
    await key(page, 'd', false);
    await atBeat(page, 2, 0.3);
    await key(page, 'g', true);
    await atBeat(page, 2, 1.3);
    await key(page, 'g', false);
    await atBeat(page, 2, 1.6);
    await page.getByTestId('transport-stop').click();
    await expect.poll(async () => (await snapshot(page)).notes.length).toBe(3);
    const recorded = await snapshot(page);
    expect(recorded.historyCount).toBe(historyBefore + 1);
    expect(recorded.notes.map((note) => note.pitch)).toEqual(PITCHES);
    expect(recorded.lane?.takes).toHaveLength(3);
    expect(recorded.clips).toHaveLength(1);
    for (const note of recorded.notes) {
        expect(isRecordingPassId(note.recordingPassId)).toBe(true);
        const matchingTakes = recorded.lane!.takes.filter((take) => take.recordingPassId === note.recordingPassId);
        expect(matchingTakes).toHaveLength(1);
        expect(matchingTakes[0].clipId).toBe(recorded.clips[0].id);
    }
    expect(new Set(recorded.notes.map((note) => note.recordingPassId)).size).toBe(3);
    expect(recorded.notes[1].startBeat).toBeGreaterThan(4);
    expect(recorded.notes[2].startBeat).toBeGreaterThan(8);
    expect(recorded.lane!.takes[2].endBeat).toBeLessThan(LOOP_END);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).notes.length).toBe(0);
    expect((await snapshot(page)).clips).toHaveLength(0);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).notes).toEqual(recorded.notes);
    expect((await snapshot(page)).lane).toEqual(recorded.lane);

    await page.getByRole('button', { name: 'Toggle variation lanes', exact: true }).click();
    const timeline = page.getByLabel('Timeline editor surface');
    await expect(timeline).toBeVisible();
    await timeline.dblclick({ position: { x: 45, y: 30 } });
    await expect(page.getByLabel('Piano roll editor')).toBeVisible();
    for (let index = 0; index < 3; index++) {
        await promote(page, recorded.lane!.takes[index], PITCHES[index], info);
        const sink = await browserPlayback(page, PITCHES[index]);
        await info.attach(`selected-${PITCHES[index]}-actual-browser-sink`, {
            body: JSON.stringify(sink),
            contentType: 'application/json',
        });
        await exportWav(page, PITCHES[index], info);
    }
    await promote(page, recorded.lane!.takes[1], 64, info);
    const beforeEdit = await snapshot(page);
    const rectangle = await page.evaluate(() => (window as EvidenceWindow).__midiCycleEvidence.rectangles[0]);
    expect(rectangle).toBeTruthy();
    await page.mouse.move(rectangle.x + rectangle.width / 2, rectangle.y + rectangle.height / 2);
    await page.mouse.down();
    await page.mouse.move(rectangle.x + rectangle.width / 2 + 40, rectangle.y + rectangle.height / 2, { steps: 4 });
    await page.mouse.up();
    await expect
        .poll(async () => (await snapshot(page)).notes.find((note) => note.id === recorded.notes[1].id)?.startBeat)
        .not.toBe(beforeEdit.notes[1].startBeat);
    expect(
        (await snapshot(page)).notes.filter((note) => note.recordingPassId !== recorded.notes[1].recordingPassId)
    ).toEqual(beforeEdit.notes.filter((note) => note.recordingPassId !== recorded.notes[1].recordingPassId));
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).notes).toEqual(beforeEdit.notes);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).notes).not.toEqual(beforeEdit.notes);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await command(page, 'Save Project');
    await expect
        .poll(() =>
            page.evaluate(async () => {
                const { projectStore } = await import('/src/modules/Project/stores/index.ts');
                return projectStore.value?.dirty;
            })
        )
        .toBe(false);
    const saved = await snapshot(page);
    // A fresh document exercises the real boot loader; setupWorkspace is not
    // repeated because its init script intentionally clears localStorage.
    const reopened = await context.newPage();
    await reopened.goto('/');
    await expect(reopened.getByRole('group', { name: 'Playback controls' })).toBeVisible({ timeout: 45_000 });
    await expect.poll(async () => (await snapshot(reopened)).notes, { timeout: 30_000 }).toEqual(saved.notes);
    expect((await snapshot(reopened)).lane).toEqual(saved.lane);
    expect((await snapshot(reopened)).clips).toEqual(saved.clips);
    await info.attach('recorded-and-reopened-identities', {
        body: JSON.stringify({ recorded, saved, reopened: await snapshot(reopened) }),
        contentType: 'application/json',
    });
    await reopened.close();
});

test('automatic punch closes an actual virtual-keyboard recording at punch out while playback continues', async ({
    page,
}, info) => {
    test.setTimeout(120_000);
    await prepare(page);
    await fixtureActions(page, [
        { type: 'setLoopEnabled', payload: { enabled: false } },
        { type: 'setPunchIn', payload: { beat: 1 } },
        { type: 'setPunchOut', payload: { beat: 3 } },
        { type: 'setPunchEnabled', payload: { enabled: true } },
    ]);
    const historyBefore = (await snapshot(page)).historyCount;
    await page.getByTestId('transport-record').click();
    await atBeat(page, 0, 1.4);
    await key(page, 'd', true);
    await expect
        .poll(
            async () => {
                const current = await clock(page);
                return current.playing === true && current.recording === false && current.beat >= 3;
            },
            { timeout: 15_000, intervals: [20] }
        )
        .toBe(true);
    await expect.poll(async () => (await snapshot(page)).notes.length).toBe(1);
    const punched = await snapshot(page);
    expect(punched.notes).toHaveLength(1);
    expect(punched.notes[0].pitch).toBe(64);
    expect(punched.notes[0].recordingPassId).toBeTruthy();
    expect(punched.historyCount).toBe(historyBefore + 1);
    await key(page, 'd', false);
    expect((await snapshot(page)).notes).toEqual(punched.notes);
    await page.getByTestId('transport-stop').click();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).notes.length).toBe(0);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).notes).toEqual(punched.notes);
    await info.attach('actual-punch-recording', { body: JSON.stringify(punched), contentType: 'application/json' });
});
