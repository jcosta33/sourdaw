// Chromium observes the virtual keyboard and built-in Web Audio synth; it does not authenticate a hardware MIDI clock.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace, wait_for_launch_first_paint, wait_for_workspace_ready } from './e2eUtils';
import { attach_first_paint_console, CAPABILITIES_MARKER, wait_for_console_marker } from './firstPaintDiagnostics';

const ROOT = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
const PROJECT_NAME = 'MIDI cycle take acceptance';
const LOOP_START = 8;
const LOOP_END = 12;
const MODIFIER = process.platform === 'darwin' ? 'Meta' : 'Control';

type CapturedNote = { id: string; pitch: number; startBeat: number; duration: number; recordingPassIndex?: number };
type CapturedTake = {
    id: string;
    name: string;
    selected: boolean;
    recordingPassIndex?: number;
    startBeat: number;
    endBeat: number;
    sourceOffsetBeats?: number;
    midiSource?: import('../../src/utils/handlerContract').MidiTakeSourceSnapshot;
};
type OscillatorStart = {
    frequency: number;
    scheduledContextSeconds: number;
    sampleRate: number;
    clock?: { beat: number; contextSeconds: number; compensationSeconds: number };
};
type Capture = {
    projectId: string;
    clipId: string | null;
    notes: CapturedNote[];
    takes: CapturedTake[];
    regions: { startBeat: number; endBeat: number; takeId: string }[];
    rawMatchesProjection: boolean;
    ownerComparison: { clips: boolean; lane: boolean; notes: boolean };
};

async function capture(page: Page, trackId: string): Promise<Capture> {
    return page.evaluate(async (id) => {
        const [{ getCrdtDoc }, { trackStore }, { takeLaneStore }, { midiStore }, { projectStore }] = await Promise.all([
            import('/src/modules/CrdtDocument/useCases/index.ts'),
            import('/src/modules/Arrangement/stores/trackStore.ts'),
            import('/src/modules/Arrangement/stores/takeLaneStore.ts'),
            import('/src/modules/MIDI/stores/midiStore.ts'),
            import('/src/modules/Project/stores/projectStore.ts'),
        ]);
        const root = getCrdtDoc<{
            tracks?: typeof trackStore.value;
            takeLanes?: typeof takeLaneStore.value;
            midi?: typeof midiStore.value;
        }>('root');
        const track = trackStore.value?.tracks.find((entry) => entry.id === id);
        const lane = takeLaneStore.value?.lanes.find((entry) => entry.trackId === id);
        const clip = track?.clips.find((entry) => entry.type === 'midi');
        const rawTrack = root?.tracks?.tracks.find((entry) => entry.id === id);
        const rawLane = root?.takeLanes?.lanes.find((entry) => entry.trackId === id);
        const projectedNotes = clip ? (midiStore.value?.notesByClipId[clip.id] ?? []) : [];
        const rawNotes = clip ? (root?.midi?.notesByClipId[clip.id] ?? []) : [];
        if (!root || !track || !projectStore.value?.projectId) {
            throw new Error('The active project has no MIDI track and authoritative document');
        }
        const clipPlacement = (clips: typeof track.clips) =>
            clips.map((entry) => ({
                id: entry.id,
                trackId: entry.trackId,
                type: entry.type,
                startBeat: entry.startBeat,
                endBeat: entry.endBeat,
                loopEnabled: entry.loopEnabled,
                loopOriginBeat: entry.loopOriginBeat,
                midiOffsetBeats: entry.midiOffsetBeats,
            }));
        const ownerComparison = {
            clips: JSON.stringify(clipPlacement(rawTrack?.clips ?? [])) === JSON.stringify(clipPlacement(track.clips)),
            lane: JSON.stringify(rawLane ?? null) === JSON.stringify(lane ?? null),
            notes: JSON.stringify(rawNotes) === JSON.stringify(projectedNotes),
        };
        return {
            projectId: projectStore.value.projectId,
            clipId: clip?.id ?? null,
            notes: projectedNotes,
            takes: lane?.takes ?? [],
            regions: lane?.activeCompRegions ?? [],
            rawMatchesProjection: Object.values(ownerComparison).every(Boolean),
            ownerComparison,
        };
    }, trackId);
}

async function phase(page: Page): Promise<{ beat: number; wraps: number }> {
    return page.evaluate(async () => {
        const [{ playheadClockRef }, { playheadWrapCountRef }] = await Promise.all([
            import('/src/modules/Transport/stores/playheadClockRef.ts'),
            import('/src/modules/Transport/stores/playheadWrapCountRef.ts'),
        ]);
        return { beat: playheadClockRef.beat, wraps: playheadWrapCountRef.current };
    });
}

async function waitForPhase(page: Page, wraps: number, beat: number): Promise<void> {
    await expect
        .poll(
            async () => {
                const observed = await phase(page);
                return observed.wraps === wraps && observed.beat >= beat && observed.beat < LOOP_END;
            },
            { timeout: 12_000, intervals: [20, 50, 100] }
        )
        .toBe(true);
}

async function keyPhrase(page: Page, key: string, wraps: number, startBeat: number, endBeat: number): Promise<void> {
    await waitForPhase(page, wraps, startBeat);
    await page.keyboard.down(key);
    await waitForPhase(page, wraps, endBeat);
    await page.keyboard.up(key);
}

async function installSynthObserver(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const scheduledValues = new WeakMap<AudioParam, number>();
        const setValueAtTime = AudioParam.prototype.setValueAtTime;
        AudioParam.prototype.setValueAtTime = function (value: number, startTime: number): AudioParam {
            scheduledValues.set(this, value);
            return Reflect.apply(setValueAtTime, this, [value, startTime]);
        };
        const start = OscillatorNode.prototype.start;
        Reflect.set(window, '__midiCycleOscillatorStarts', []);
        OscillatorNode.prototype.start = function (...args): void {
            const readClock = Reflect.get(window, '__midiCycleReadClock') as
                (() => OscillatorStart['clock']) | undefined;
            (Reflect.get(window, '__midiCycleOscillatorStarts') as OscillatorStart[]).push({
                frequency: scheduledValues.get(this.frequency) ?? this.frequency.value,
                scheduledContextSeconds: args[0] ?? this.context.currentTime,
                sampleRate: this.context.sampleRate,
                clock: readClock?.(),
            });
            Reflect.apply(start, this, args);
        };
    });
}

async function clearSynthStarts(page: Page): Promise<void> {
    await page.evaluate(() => Reflect.set(window, '__midiCycleOscillatorStarts', []));
}

async function synthPitches(page: Page): Promise<number[]> {
    return page.evaluate(() => {
        const starts = Reflect.get(window, '__midiCycleOscillatorStarts') as OscillatorStart[];
        return starts.map(({ frequency }) => Math.round(69 + 12 * Math.log2(frequency / 440)));
    });
}

async function installPlaybackClockObserver(page: Page, trackId: string): Promise<void> {
    const clock = await page.evaluate(async (id) => {
        const [{ getCompensationDelay }, { playheadClockRef }, { tempoMapStore, transportStore }] = await Promise.all([
            import('/src/modules/AudioEngine/useCases/index.ts'),
            import('/src/modules/Transport/stores/playheadClockRef.ts'),
            import('/src/modules/Transport/stores/index.ts'),
        ]);
        const readClock = () => ({
            beat: playheadClockRef.beat,
            contextSeconds: playheadClockRef.audioTimeSeconds,
            compensationSeconds: getCompensationDelay(id),
        });
        Reflect.set(window, '__midiCycleReadClock', readClock);
        return {
            tempo: transportStore.value?.tempo,
            tempoChanges: tempoMapStore.value?.changes,
            compensationSeconds: getCompensationDelay(id),
        };
    }, trackId);
    expect(clock.tempo).toBe(120);
    expect(clock.tempoChanges).toEqual([]);
    expect(clock.compensationSeconds).toBe(0);
}

async function scheduledPitchesInInterval(page: Page, startBeat: number, endBeat: number): Promise<number[]> {
    const starts = await page.evaluate(() => Reflect.get(window, '__midiCycleOscillatorStarts') as OscillatorStart[]);
    const boundaryFrame = (start: OscillatorStart, beat: number): number => {
        if (!start.clock) {
            throw new Error('The scheduled oscillator has no published transport clock anchor');
        }
        return (
            Math.round(start.clock.contextSeconds * start.sampleRate) +
            Math.round((beat - start.clock.beat) * 0.5 * start.sampleRate) +
            Math.round(start.clock.compensationSeconds * start.sampleRate)
        );
    };
    return starts
        .filter((start) => {
            const frame = Math.round(start.scheduledContextSeconds * start.sampleRate);
            return frame >= boundaryFrame(start, startBeat) - 1 && frame < boundaryFrame(start, endBeat) - 1;
        })
        .map(({ frequency }) => Math.round(69 + 12 * Math.log2(frequency / 440)));
}

async function selectTake(page: Page, take: CapturedTake): Promise<void> {
    const promote = page.getByRole('button', { name: `Promote ${take.name} to main take` });
    await expect(promote).toBeVisible();
    await promote.click();
    await expect(promote).toHaveAttribute('aria-pressed', 'true');
}

async function seek(page: Page, beat: number): Promise<void> {
    await page.evaluate(async (targetBeat) => {
        const { executeAppAction } = await import('/src/modules/Command/useCases/index.ts');
        await executeAppAction({ type: 'seekPlayhead', payload: { beat: targetBeat } }, { skipUndo: true });
    }, beat);
}

async function compTake(page: Page, trackId: string, takeId: string, endBeat: number): Promise<void> {
    await page.evaluate(
        async ({ id, selectedTakeId, start, end }) => {
            const { executeAppAction } = await import('/src/modules/Command/useCases/index.ts');
            await executeAppAction({
                type: 'setCompRegion',
                payload: { trackId: id, takeId: selectedTakeId, startBeat: start, endBeat: end },
            });
        },
        { id: trackId, selectedTakeId: takeId, start: LOOP_START, end: endBeat }
    );
}

test.describe.serial('recorded MIDI cycle take acceptance', () => {
    let acceptanceContext: BrowserContext;
    let acceptancePage: Page;
    let recordedTrackId: string;

    test.beforeAll(async ({ browser }) => {
        acceptanceContext = await browser.newContext();
        acceptancePage = await acceptanceContext.newPage();
    });
    test.afterAll(async () => {
        await acceptanceContext.close();
    });

    test('records three distinct MIDI passes, seals Stop, and replays selected passes after saved reopen', async ({
        browser,
    }, testInfo) => {
        test.setTimeout(180_000);
        expect(browser.browserType().name()).toBe('chromium');
        const page = acceptancePage;
        const context = acceptanceContext;
        const boot = attach_first_paint_console(page);
        await installSynthObserver(page);
        await setupWorkspace(page);
        await wait_for_console_marker(boot, CAPABILITIES_MARKER, 30_000);
        await launch_new_project(page);
        const response = await page.request.get('/');
        expect(decodeURIComponent(response.headers()['x-sourdaw-root'] ?? '')).toBe(ROOT);
        await page.getByTestId('project-name').click();
        await page.locator('input:focus').fill(PROJECT_NAME);
        await page.locator('input:focus').press('Enter');

        const trackId = await page.evaluate(async () => {
            const [{ executeAppAction }, { trackStore }] = await Promise.all([
                import('/src/modules/Command/useCases/index.ts'),
                import('/src/modules/Arrangement/stores/trackStore.ts'),
            ]);
            await executeAppAction(
                { type: 'addTrack', payload: { name: 'Cycle keys', kind: 'midi' } },
                { skipUndo: true }
            );
            const track = trackStore.value?.tracks.find(
                (entry) => entry.name === 'Cycle keys' && entry.kind === 'midi'
            );
            if (!track) {
                throw new Error('Typed track action did not create Cycle keys');
            }
            await executeAppAction(
                { type: 'armTrack', payload: { trackId: track.id, armed: true } },
                { skipUndo: true }
            );
            await executeAppAction(
                { type: 'setLoopRegion', payload: { startBeat: 8, endBeat: 12 } },
                { skipUndo: true }
            );
            await executeAppAction({ type: 'seekPlayhead', payload: { beat: 8 } }, { skipUndo: true });
            return track.id;
        });
        recordedTrackId = trackId;
        await expect(page.getByTestId(`track-arm-${trackId}`)).toHaveAttribute('aria-label', 'Disarm Cycle keys');
        await page.getByTestId('transport-loop').click();
        await expect(page.getByTestId('transport-loop')).toHaveAttribute('aria-pressed', 'true');
        await page.getByTestId('toggle-virtual-keyboard').click();
        // The open keyboard captures the computer keyboard wherever focus is.
        await expect(page.getByRole('region', { name: 'Virtual Piano Keyboard' })).toBeVisible();

        const firstWrap = (await phase(page)).wraps;
        await page.getByTestId('transport-record').click();
        await expect(page.getByTestId('transport-record')).toHaveAttribute('aria-pressed', 'true');
        await keyPhrase(page, 'a', firstWrap, 8.4, 9.0); // C4, pass 1
        await waitForPhase(page, firstWrap, 11.2);
        await page.keyboard.down('g'); // G4 belongs to its onset pass across the seam.
        await waitForPhase(page, firstWrap + 1, 8.25);
        await page.keyboard.up('g');
        await waitForPhase(page, firstWrap + 1, 8.7);
        await page.keyboard.down('s'); // D4 owns pass 2 even while held across its seam.
        await waitForPhase(page, firstWrap + 2, 8.25);
        await page.keyboard.up('s');
        await waitForPhase(page, firstWrap + 2, 8.7);
        await page.keyboard.down('d'); // E4 is admitted immediately before Stop seals this session.
        await waitForPhase(page, firstWrap + 2, 9.15);
        await page.getByTestId('transport-stop').click();
        await expect(page.getByTestId('transport-record')).toHaveAttribute('aria-pressed', 'false');
        await expect.poll(async () => (await capture(page, trackId)).takes.length, { timeout: 30_000 }).toBe(3);
        const recorded = await capture(page, trackId);
        expect(recorded.rawMatchesProjection, JSON.stringify(recorded.ownerComparison)).toBe(true);
        expect(recorded.notes.map((note) => [note.pitch, note.recordingPassIndex])).toEqual([
            [60, 0],
            [67, 0],
            [62, 1],
            [64, 2],
        ]);
        expect(recorded.notes.find((note) => note.pitch === 67)?.duration).toBeGreaterThan(0.5);
        expect(recorded.notes.find((note) => note.pitch === 62)?.duration).toBeGreaterThan(3);
        expect(recorded.notes.find((note) => note.pitch === 64)?.duration).toBeGreaterThan(0);
        expect(await synthPitches(page), 'the browser Web Audio observer must see the live D4 voice').toContain(62);
        expect(recorded.takes.map((take) => take.recordingPassIndex).sort()).toEqual([0, 1, 2]);
        expect(recorded.takes.find((take) => take.recordingPassIndex === 2)?.endBeat).toBeLessThan(LOOP_END);
        await testInfo.attach('recorded-pass-owners', {
            body: JSON.stringify(
                {
                    clipId: recorded.clipId,
                    notes: recorded.notes,
                    takes: recorded.takes.map((take) => ({
                        id: take.id,
                        recordingPassIndex: take.recordingPassIndex,
                        sourceOffsetBeats: take.sourceOffsetBeats,
                        startBeat: take.startBeat,
                        endBeat: take.endBeat,
                    })),
                    ownerComparison: recorded.ownerComparison,
                },
                null,
                2
            ),
            contentType: 'application/json',
        });

        await page.getByTestId('transport-undo').click();
        await expect.poll(async () => (await capture(page, trackId)).clipId).toBeNull();
        const undone = await capture(page, trackId);
        expect(undone.rawMatchesProjection).toBe(true);
        expect(undone.takes).toHaveLength(0);
        await page.getByTestId('transport-redo').click();
        await expect.poll(async () => (await capture(page, trackId)).notes.length).toBe(4);
        const redone = await capture(page, trackId);
        expect(redone.rawMatchesProjection).toBe(true);
        expect(redone.clipId).toBe(recorded.clipId);
        expect(redone.notes).toEqual(recorded.notes);
        expect(redone.takes).toEqual(recorded.takes);

        const row = page
            .getByRole('grid', { name: /Track list/i })
            .first()
            .getByRole('row')
            .filter({ hasText: 'Cycle keys' });
        const variationToggle = row.getByRole('button', { name: 'Toggle variation lanes' });
        await expect(variationToggle).toBeVisible();
        if ((await variationToggle.getAttribute('aria-pressed')) !== 'true') {
            await variationToggle.click();
        }
        const secondPass = redone.takes.find((take) => take.recordingPassIndex === 1);
        if (!secondPass) {
            throw new Error('The second recorded take is absent');
        }
        await selectTake(page, secondPass);
        // An exact whole-loop region prevents a base gap from admitting the preceding held note.
        await compTake(page, trackId, secondPass.id, LOOP_END);
        await expect.poll(async () => (await capture(page, trackId)).regions.length).toBe(1);
        expect((await capture(page, trackId)).regions).toEqual([
            { startBeat: LOOP_START, endBeat: LOOP_END, takeId: secondPass.id },
        ]);
        await page.getByTestId(`track-arm-${trackId}`).click();
        await expect(page.getByTestId(`track-arm-${trackId}`)).toHaveAttribute('aria-label', 'Arm Cycle keys');
        await clearSynthStarts(page);
        await seek(page, LOOP_START);
        await page.getByTestId('transport-play').click();
        await expect.poll(() => synthPitches(page), { timeout: 8_000 }).toContain(62);
        await page.getByTestId('transport-stop').click();
        const heard = await synthPitches(page);
        await testInfo.attach('selected-pass-browser-starts', {
            body: JSON.stringify(
                {
                    selectedTakeId: secondPass.id,
                    selectedPassIndex: secondPass.recordingPassIndex,
                    regions: (await capture(page, trackId)).regions,
                    oscillatorPitches: heard,
                },
                null,
                2
            ),
            contentType: 'application/json',
        });
        expect(heard).toContain(62);
        expect(heard).not.toContain(60);
        expect(heard).not.toContain(67);
        expect(heard).not.toContain(64);

        const firstPass = redone.takes.find((take) => take.recordingPassIndex === 0);
        if (!firstPass) {
            throw new Error('The first recorded take is absent');
        }
        await selectTake(page, firstPass);
        await compTake(page, trackId, firstPass.id, LOOP_END);
        await clearSynthStarts(page);
        await seek(page, LOOP_START);
        await page.getByTestId('transport-play').click();
        await expect.poll(() => synthPitches(page), { timeout: 8_000 }).toContain(67);
        await page.getByTestId('transport-stop').click();
        const firstHeard = await synthPitches(page);
        expect(firstHeard).toContain(60);
        expect(firstHeard).toContain(67);
        expect(firstHeard).not.toContain(62);
        expect(firstHeard).not.toContain(64);

        await selectTake(page, secondPass);
        await compTake(page, trackId, secondPass.id, LOOP_END);
        await expect
            .poll(async () => (await capture(page, trackId)).regions)
            .toEqual([{ startBeat: LOOP_START, endBeat: LOOP_END, takeId: secondPass.id }]);

        await page.keyboard.press(`${MODIFIER}+k`);
        const input = page.getByTestId('command-palette-input');
        await expect(input).toBeVisible();
        await input.fill('Save Project');
        await page
            .getByRole('option')
            .filter({ has: page.getByText('Save Project', { exact: true }) })
            .click();
        await expect(page.getByTitle('Unsaved changes')).toHaveCount(0, { timeout: 30_000 });
        const saved = await capture(page, trackId);
        expect(saved.rawMatchesProjection).toBe(true);
        await page.close();

        const reopened = await context.newPage();
        await installSynthObserver(reopened);
        const reopenBoot = attach_first_paint_console(reopened);
        const reopenResponse = await reopened.goto('/');
        expect(decodeURIComponent(reopenResponse?.headers()['x-sourdaw-root'] ?? '')).toBe(ROOT);
        await wait_for_console_marker(reopenBoot, CAPABILITIES_MARKER, 30_000);
        const mode = async () =>
            reopened.evaluate(async (projectId) => {
                const { projectStore } = await import('/src/modules/Project/stores/projectStore.ts');
                const state = projectStore.value;
                if (!state || state.loading) {
                    return 'pending';
                }
                if (state.initialized) {
                    return state.projectId === projectId ? 'saved-active' : 'wrong-active';
                }
                return 'launch-ready';
            }, saved.projectId);
        await expect.poll(mode, { timeout: 30_000 }).toMatch(/^(saved-active|launch-ready)$/);
        if ((await mode()) === 'launch-ready') {
            await wait_for_launch_first_paint(reopened);
            await reopened.getByRole('button', { name: `Open recent project ${PROJECT_NAME}` }).click();
        }
        await wait_for_workspace_ready(reopened);
        await expect.poll(async () => (await capture(reopened, trackId)).projectId).toBe(saved.projectId);
        const persisted = await capture(reopened, trackId);
        expect(persisted.rawMatchesProjection).toBe(true);
        expect(persisted.notes).toEqual(saved.notes);
        expect(persisted.takes).toEqual(saved.takes);
        expect(persisted.regions).toEqual(saved.regions);
        await clearSynthStarts(reopened);
        await seek(reopened, LOOP_START);
        await reopened.getByTestId('transport-play').click();
        await expect.poll(() => synthPitches(reopened), { timeout: 8_000 }).toContain(62);
        await reopened.getByTestId('transport-stop').click();
        const replay = await synthPitches(reopened);
        expect(replay).toContain(62);
        expect(replay).not.toContain(60);
        expect(replay).not.toContain(67);
        expect(replay).not.toContain(64);
        acceptancePage = reopened;
    });

    test('selected final unfrozen pass replays its own E4 after saved reopen', async () => {
        test.setTimeout(60_000);
        let page = acceptancePage;
        const recorded = await capture(page, recordedTrackId);
        const finalPass = recorded.takes.find((take) => take.recordingPassIndex === 2);
        if (!finalPass) {
            throw new Error('The final recorded take is absent');
        }
        const row = page
            .getByRole('grid', { name: /Track list/i })
            .first()
            .getByRole('row')
            .filter({ hasText: 'Cycle keys' });
        const variationToggle = row.getByRole('button', { name: 'Toggle variation lanes' });
        await expect(variationToggle).toBeVisible();
        if ((await variationToggle.getAttribute('aria-pressed')) !== 'true') {
            await variationToggle.click();
        }
        await selectTake(page, finalPass);
        await compTake(page, recordedTrackId, finalPass.id, finalPass.endBeat);
        await expect
            .poll(async () => (await capture(page, recordedTrackId)).regions)
            .toEqual([
                { startBeat: LOOP_START, endBeat: finalPass.endBeat, takeId: finalPass.id },
                { startBeat: finalPass.endBeat, endBeat: LOOP_END, takeId: recorded.regions[0].takeId },
            ]);
        await page.keyboard.press(`${MODIFIER}+k`);
        await expect(page.getByTestId('command-palette-input')).toBeVisible();
        await page.getByTestId('command-palette-input').fill('Save Project');
        await page
            .getByRole('option')
            .filter({ has: page.getByText('Save Project', { exact: true }) })
            .click();
        await expect(page.getByTitle('Unsaved changes')).toHaveCount(0, { timeout: 30_000 });
        const saved = await capture(page, recordedTrackId);
        expect(saved.rawMatchesProjection).toBe(true);
        await page.close();
        page = await acceptanceContext.newPage();
        await installSynthObserver(page);
        const boot = attach_first_paint_console(page);
        const response = await page.goto('/');
        expect(decodeURIComponent(response?.headers()['x-sourdaw-root'] ?? '')).toBe(ROOT);
        await wait_for_console_marker(boot, CAPABILITIES_MARKER, 30_000);
        const mode = async () =>
            page.evaluate(async (projectId) => {
                const { projectStore } = await import('/src/modules/Project/stores/projectStore.ts');
                const state = projectStore.value;
                if (!state || state.loading) {
                    return 'pending';
                }
                return state.initialized
                    ? state.projectId === projectId
                        ? 'saved-active'
                        : 'wrong-active'
                    : 'launch-ready';
            }, saved.projectId);
        await expect.poll(mode, { timeout: 30_000 }).toMatch(/^(saved-active|launch-ready)$/);
        if ((await mode()) === 'launch-ready') {
            await wait_for_launch_first_paint(page);
            await page.getByRole('button', { name: `Open recent project ${PROJECT_NAME}` }).click();
        }
        await wait_for_workspace_ready(page);
        const persisted = await capture(page, recordedTrackId);
        expect(persisted.rawMatchesProjection).toBe(true);
        expect(persisted.notes).toEqual(saved.notes);
        expect(persisted.takes).toEqual(saved.takes);
        expect(persisted.regions).toEqual(saved.regions);
        expect(persisted.takes.find((take) => take.selected)?.recordingPassIndex).toBe(2);
        expect(persisted.takes.find((take) => take.recordingPassIndex === 2)).not.toHaveProperty('midiSource');
        acceptancePage = page;
        await installPlaybackClockObserver(page, recordedTrackId);
        await clearSynthStarts(page);
        await seek(page, LOOP_START);
        await page.getByTestId('transport-play').click();
        await expect.poll(() => synthPitches(page), { timeout: 8_000 }).toContain(64);
        await expect
            .poll(
                async () => {
                    const observed = await phase(page);
                    return observed.wraps === 0 && observed.beat > finalPass.endBeat + 0.1;
                },
                { timeout: 8_000 }
            )
            .toBe(true);
        await page.getByTestId('transport-stop').click();
        const finalInterval = await scheduledPitchesInInterval(page, LOOP_START, finalPass.endBeat);
        expect(finalInterval).toContain(64);
        expect(finalInterval).not.toContain(60);
        expect(finalInterval).not.toContain(62);
        expect(finalInterval).not.toContain(67);
        const followingInterval = await scheduledPitchesInInterval(page, finalPass.endBeat, LOOP_END);
        expect(followingInterval).toContain(62);
        expect(followingInterval).not.toContain(60);
        expect(followingInterval).not.toContain(64);
        expect(followingInterval).not.toContain(67);
    });
    test('frozen selected MIDI source survives named save, recent load, and malformed import refusal', async ({}, testInfo) => {
        test.setTimeout(120_000);
        const page = acceptancePage;
        const recorded = await capture(page, recordedTrackId);
        const secondPass = recorded.takes.find((take) => take.recordingPassIndex === 1);
        if (!secondPass || !recorded.clipId) {
            throw new Error('Recorded second pass or MIDI clip missing');
        }
        await selectTake(page, secondPass);
        await compTake(page, recordedTrackId, secondPass.id, LOOP_END);
        await page.evaluate(
            async ({ clipId }) => {
                const { executeAppAction } = await import('/src/modules/Command/useCases/index.ts');
                await executeAppAction({ type: 'splitClip', payload: { clipId, beat: 10 } });
            },
            { clipId: recorded.clipId }
        );
        const before = await capture(page, recordedTrackId);
        const selected = before.takes.find(
            (take) => take.selected && take.midiSource && take.startBeat <= 8.7 && take.endBeat > 8.7
        );
        expect(selected, 'split must freeze the selected pass containing D4').toBeDefined();
        if (!selected?.midiSource) {
            throw new Error('Selected frozen MIDI source missing');
        }
        expect(selected.midiSource.sourceEntryBeat).not.toBe(0);
        expect(selected.midiSource.phaseHeadBeat).toBe(selected.startBeat);
        expect(selected.recordingPassIndex).toBe(1);
        expect(selected.midiSource.rows.notes.value.map((note) => note.pitch)).toContain(62);
        expect(before.rawMatchesProjection).toBe(true);
        await page.keyboard.press(`${MODIFIER}+k`);
        await expect(page.getByTestId('command-palette-input')).toBeVisible();
        await page.getByTestId('command-palette-input').fill('Save Project');
        await page
            .getByRole('option')
            .filter({ has: page.getByText('Save Project', { exact: true }) })
            .click();
        await expect(page.getByTitle('Unsaved changes')).toHaveCount(0, { timeout: 30_000 });
        const named = await page.evaluate(async (name) => {
            const [{ getRecentProjects }, { readNamedProjectJson }] = await Promise.all([
                import('/src/modules/Project/useCases/index.ts'),
                import('/src/modules/Project/repositories/project/readNamedProjectJson.ts'),
            ]);
            const entry = getRecentProjects().find((item) => item.name === name);
            if (!entry) throw new Error('Named recent project is missing');
            const raw = await readNamedProjectJson(entry.key);
            if (!raw) throw new Error('Named project JSON is missing');
            return {
                key: entry.key,
                data: JSON.parse(raw) as import('../../src/modules/Project/models/ProjectData').ProjectData,
            };
        }, PROJECT_NAME);
        const namedLane = named.data.takeLanes?.lanes.find((lane) => lane.trackId === recordedTrackId);
        expect(namedLane?.takes.find((take) => take.id === selected.id)?.midiSource).toEqual(selected.midiSource);
        expect(namedLane?.takes.find((take) => take.id === selected.id)?.recordingPassIndex).toBe(1);
        expect(namedLane?.activeCompRegions).toEqual(before.regions);
        const outcome = await page.evaluate(async (key) => {
            const { loadRecentProject } =
                await import('/src/modules/Project/useCases/recentProjects/loadRecentProject.ts');
            return loadRecentProject(key, { outgoingProject: 'discard' });
        }, named.key);
        expect(outcome).toBe('committed');
        await wait_for_workspace_ready(page);
        const reopened = await capture(page, recordedTrackId);
        expect(reopened.rawMatchesProjection).toBe(true);
        expect(reopened.takes.find((take) => take.id === selected.id)).toEqual(selected);
        expect(reopened.regions).toEqual(before.regions);
        await clearSynthStarts(page);
        await seek(page, LOOP_START);
        await page.getByTestId('transport-play').click();
        await expect.poll(() => synthPitches(page), { timeout: 8_000 }).toContain(62);
        await page.getByTestId('transport-stop').click();
        const pitches = await synthPitches(page);
        expect(pitches).not.toContain(60);
        expect(pitches).not.toContain(64);
        expect(pitches).not.toContain(67);
        await testInfo.attach('frozen-midi-source-save-import-evidence', {
            body: JSON.stringify({ before, named: namedLane, reopened, pitches }, null, 2),
            contentType: 'application/json',
        });

        const refusal = await page.evaluate(
            async ({ key, trackId }) => {
                const [
                    { readNamedProjectJson },
                    { applyImportedProjectData },
                    { getCrdtDoc, captureProjectRootIdentity },
                    { trackStore, takeLaneStore, clipSelectionStore },
                    { projectStore, arrangementStore },
                    { undoHistoryStore },
                    { executeAppAction, undo },
                ] = await Promise.all([
                    import('/src/modules/Project/repositories/project/readNamedProjectJson.ts'),
                    import('/src/modules/Project/useCases/projectPersistence/fileIO/applyImportedProjectData.ts'),
                    import('/src/modules/CrdtDocument/useCases/index.ts'),
                    import('/src/modules/Arrangement/stores/index.ts'),
                    import('/src/modules/Project/stores/index.ts'),
                    import('/src/modules/Command/stores/index.ts'),
                    import('/src/modules/Command/useCases/index.ts'),
                ]);
                await executeAppAction({ type: 'renameTrack', payload: { trackId, name: 'Cycle keys one' } });
                await executeAppAction({ type: 'renameTrack', payload: { trackId, name: 'Cycle keys two' } });
                await undo();
                const snapshot = () =>
                    JSON.stringify({
                        root: getCrdtDoc('root'),
                        rootIdentity: captureProjectRootIdentity(),
                        tracks: trackStore.value,
                        takes: takeLaneStore.value,
                        selection: clipSelectionStore.value,
                        project: projectStore.value,
                        arrangements: arrangementStore.value,
                        history: undoHistoryStore.value,
                    });
                const history = undoHistoryStore.value;
                if (!history?.past.length || !history.future.length)
                    throw new Error('Undo and Redo must both contain entries');
                const beforeImport = snapshot();
                const raw = await readNamedProjectJson(key);
                if (!raw) throw new Error('Named JSON missing before malformed import');
                const results = [];
                for (const route of ['top', 'saved'] as const) {
                    const data = JSON.parse(raw) as import('../../src/modules/Project/models/ProjectData').ProjectData;
                    const lanes =
                        route === 'top'
                            ? data.takeLanes
                            : data.arrangements?.find((item) => item.id === data.activeArrangementId)?.takeLanes;
                    const take = lanes?.lanes.flatMap((lane) => lane.takes).find((item) => item.midiSource);
                    if (!take?.midiSource) throw new Error(`Frozen source absent in ${route}`);
                    const malformed = structuredClone(take.midiSource);
                    const malformedRows = {
                        ...malformed.rows,
                        notes: { present: false, value: malformed.rows.notes.value },
                    };
                    take.midiSource = { ...malformed, rows: malformedRows };
                    const fileContent = JSON.stringify(data);
                    const result = await applyImportedProjectData({ data: JSON.parse(fileContent) });
                    results.push({ route, result, unchanged: snapshot() === beforeImport });
                }
                return results;
            },
            { key: named.key, trackId: recordedTrackId }
        );
        expect(refusal).toEqual([
            { route: 'top', result: false, unchanged: true },
            { route: 'saved', result: false, unchanged: true },
        ]);
    });
});
