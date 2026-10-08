import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createExportError } from '../../../errors/ExportError';
import { type captureOfflineRenderInput } from '../captureOfflineRenderInput';
import { checkCancel } from '../checkCancel';
import { RENDER_RELEASE_TIMEOUT_MS } from '../constants';
import { executeOfflineRender } from '../executeOfflineRender';
import { cancelExport } from '../exportCancellation';
import { exportCancellationState } from '../exportCancellationState';
import { isExportActive } from '../isExportActive';
import { isRenderBusyError } from '../isRenderBusyError';

type CapturedInput = ReturnType<typeof captureOfflineRenderInput>;

type StartedRender = {
    /** The stop the renderer would read at its checkpoints. */
    abortSignal: AbortSignal | undefined;
    finish: () => void;
    fail: (error: Error) => void;
};

const mocks = vi.hoisted(() => ({
    events: [] as string[],
    started: [] as StartedRender[],
    /** What each render's instrument setup stops on, in start order. */
    cancellationSignals: [] as (AbortSignal | undefined)[],
    /** Whether a started render ends at its stop, as the segmented renderer does at its next checkpoint. */
    honoursStop: { value: true },
    scheduleOfflineMix: vi.fn(),
}));

vi.mock('../../../repositories/offlineScheduler/makeOfflineFrameScheduler', () => ({
    makeOfflineFrameScheduler: vi.fn(),
}));
vi.mock('../buildOfflineWebAudioGraph', () => ({ buildOfflineWebAudioGraph: vi.fn(() => Promise.resolve({})) }));
vi.mock('../createOfflineRenderBackend', () => ({
    createOfflineRenderBackend: vi.fn(({ cancellationSignal }: { cancellationSignal?: AbortSignal }) => {
        mocks.cancellationSignals.push(cancellationSignal);
        return { dispose: () => mocks.events.push('render-released-resources') };
    }),
}));
vi.mock('../cropHistoryFromRenderedBuffer', () => ({
    cropHistoryFromRenderedBuffer: ({ buffer }: { buffer: AudioBuffer }) => buffer,
}));
vi.mock('../resolveOfflineMixPlan', () => ({
    resolveOfflineMixPlan: vi.fn(() => ({ frameCount: 128, masterGainValue: 1 })),
}));
vi.mock('../scheduleOfflineMix', () => ({ scheduleOfflineMix: mocks.scheduleOfflineMix }));
vi.mock('../tryNativeOfflineRender', () => ({ tryNativeOfflineRender: vi.fn(() => Promise.resolve(null)) }));

class FakeOfflineContext {
    destination = {};
    createGain() {
        return { gain: { value: 1 }, connect: vi.fn() };
    }
}

function renderedBuffer(label: string): AudioBuffer {
    return { label, sampleRate: 48_000, length: 128, numberOfChannels: 2 } as unknown as AudioBuffer;
}

function capturing(label: string): () => CapturedInput {
    return () => {
        mocks.events.push(`${label}-captured`);
        return {
            sampleRate: 48_000,
            historySeconds: 0,
            outputDurationSeconds: 1,
            instruments: [],
            loadedExternalInstanceIds: [],
        } as unknown as CapturedInput;
    };
}

function startedRender(index: number): StartedRender {
    const render = mocks.started[index];
    if (render === undefined) {
        throw new Error(`render ${index} has not started`);
    }
    return render;
}

async function renderStarted(count: number): Promise<void> {
    await vi.waitFor(() => expect(mocks.started).toHaveLength(count));
}

/** Settles with the render's outcome so an expected rejection is never left unhandled. */
function outcomeOf(render: Promise<AudioBuffer>): Promise<{ buffer: AudioBuffer } | { error: unknown }> {
    return render.then(
        (buffer) => ({ buffer }),
        (error: unknown) => ({ error })
    );
}

beforeEach(() => {
    mocks.events.length = 0;
    mocks.started.length = 0;
    mocks.cancellationSignals.length = 0;
    mocks.honoursStop.value = true;
    exportCancellationState.cancelFlag = false;
    exportCancellationState.renderLock = null;
    exportCancellationState.queuedMusicianExport = null;
    vi.stubGlobal('OfflineAudioContext', FakeOfflineContext);
    mocks.scheduleOfflineMix.mockImplementation(
        ({ callbacks }: { callbacks: { abortSignal?: AbortSignal } }) =>
            new Promise<AudioBuffer>((resolve, reject) => {
                const label = `render-${mocks.started.length}`;
                mocks.started.push({
                    abortSignal: callbacks.abortSignal,
                    finish: () => resolve(renderedBuffer(label)),
                    fail: reject,
                });
                callbacks.abortSignal?.addEventListener('abort', () => {
                    if (mocks.honoursStop.value) {
                        mocks.events.push(`${label}-stopped`);
                        reject(createExportError('Export cancelled'));
                    }
                });
            })
    );
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    exportCancellationState.cancelFlag = false;
    exportCancellationState.renderLock = null;
    exportCancellationState.queuedMusicianExport = null;
});

describe('executeOfflineRender — a musician export outranks an agent measurement', () => {
    it('stops the measurement, waits for its release, then renders the export without an error', async () => {
        const measurement = outcomeOf(
            executeOfflineRender(capturing('measurement'), { lockHolder: 'agent-measurement' })
        );
        await renderStarted(1);

        const musician = outcomeOf(executeOfflineRender(capturing('export')));
        const measurementOutcome = await measurement;

        expect(measurementOutcome).toMatchObject({ error: expect.any(Error) });
        const { error } = measurementOutcome as { error: unknown };
        expect(isRenderBusyError(error)).toBe(true);
        expect(error).toMatchObject({ message: "The assistant's measurement stopped because an export started." });
        // The musician's export took no part in the cancel flag every other render reads.
        expect(exportCancellationState.cancelFlag).toBe(false);

        await renderStarted(2);
        // The export read the project only after the measurement had stopped and released its resources.
        expect(mocks.events).toEqual([
            'measurement-captured',
            'render-0-stopped',
            'render-released-resources',
            'export-captured',
        ]);
        expect(startedRender(1).abortSignal).toBeUndefined();

        startedRender(1).finish();
        expect(await musician).toEqual({ buffer: expect.objectContaining({ label: 'render-1' }) });
        expect(isExportActive()).toBe(false);
    });

    it('lets a measurement own stop win over the busy refusal', async () => {
        const stop = new AbortController();
        const measurement = outcomeOf(
            executeOfflineRender(capturing('measurement'), {
                lockHolder: 'agent-measurement',
                abortSignal: stop.signal,
            })
        );
        await renderStarted(1);

        stop.abort();
        const musician = outcomeOf(executeOfflineRender(capturing('export')));
        const measurementOutcome = (await measurement) as { error: unknown };

        expect(isRenderBusyError(measurementOutcome.error)).toBe(false);
        expect(measurementOutcome.error).toMatchObject({ message: 'Export cancelled' });
        await renderStarted(2);
        startedRender(1).finish();
        await musician;
    });

    it('refuses a second export with the message it always had while the first waits for a measurement', async () => {
        mocks.honoursStop.value = false;
        const measurement = outcomeOf(
            executeOfflineRender(capturing('measurement'), { lockHolder: 'agent-measurement' })
        );
        await renderStarted(1);

        const first = outcomeOf(executeOfflineRender(capturing('first-export')));
        const second = (await outcomeOf(executeOfflineRender(capturing('second-export')))) as { error: unknown };

        expect(second.error).toMatchObject({
            _tag: 'Export',
            message: 'An export is already in progress. Cancel the current export before starting a new one.',
        });
        expect(isExportActive()).toBe(true);

        cancelExport();
        expect(await first).toMatchObject({ error: { message: 'Export cancelled' } });
        startedRender(0).finish();
        await measurement;
    });

    it('refuses a second measurement as render-busy while the first is being stopped for an export', async () => {
        mocks.honoursStop.value = false;
        const running = outcomeOf(executeOfflineRender(capturing('measurement'), { lockHolder: 'agent-measurement' }));
        await renderStarted(1);
        const waiting = outcomeOf(executeOfflineRender(capturing('export')));

        const second = (await outcomeOf(
            executeOfflineRender(capturing('second-measurement'), { lockHolder: 'agent-measurement' })
        )) as { error: unknown };

        expect(isRenderBusyError(second.error)).toBe(true);
        expect(mocks.events).not.toContain('second-measurement-captured');

        startedRender(0).finish();
        await running;
        await renderStarted(2);
        startedRender(1).finish();
        await waiting;
    });
});

describe('executeOfflineRender — a measurement never outranks a musician export', () => {
    it('refuses a measurement as render-busy before capturing, and leaves the export rendering', async () => {
        const musician = outcomeOf(executeOfflineRender(capturing('export')));
        await renderStarted(1);

        const measurement = (await outcomeOf(
            executeOfflineRender(capturing('measurement'), { lockHolder: 'agent-measurement' })
        )) as { error: unknown };

        expect(isRenderBusyError(measurement.error)).toBe(true);
        expect(mocks.events).toEqual(['export-captured']);
        expect(startedRender(0).abortSignal?.aborted ?? false).toBe(false);
        expect(isExportActive()).toBe(true);

        startedRender(0).finish();
        expect(await musician).toMatchObject({ buffer: expect.objectContaining({ label: 'render-0' }) });
    });

    it('refuses a second export with the message it always had', async () => {
        const first = outcomeOf(executeOfflineRender(capturing('first-export')));
        await renderStarted(1);

        const second = (await outcomeOf(executeOfflineRender(capturing('second-export')))) as { error: unknown };

        expect(second.error).toMatchObject({
            _tag: 'Export',
            message: 'An export is already in progress. Cancel the current export before starting a new one.',
        });
        expect(mocks.events).toEqual(['first-export-captured']);

        startedRender(0).finish();
        await first;
    });
});

describe('executeOfflineRender — a measurement that does not release', () => {
    it('fails the export with a clear message once the release bound passes, and renders nothing', async () => {
        vi.useFakeTimers();
        mocks.honoursStop.value = false;
        const measurement = outcomeOf(
            executeOfflineRender(capturing('measurement'), { lockHolder: 'agent-measurement' })
        );
        await renderStarted(1);

        let exportSettled = false;
        const musician = outcomeOf(executeOfflineRender(capturing('export'))).then((outcome) => {
            exportSettled = true;
            return outcome;
        });

        await vi.advanceTimersByTimeAsync(RENDER_RELEASE_TIMEOUT_MS - 1);
        expect(exportSettled).toBe(false);
        expect(isExportActive()).toBe(true);

        await vi.advanceTimersByTimeAsync(1);
        const failure = (await musician) as { error: unknown };

        expect(failure.error).toMatchObject({
            _tag: 'Export',
            message:
                "The assistant's measurement did not stop in time to start this export. Try the export again in a moment.",
        });
        expect(mocks.events).toEqual(['measurement-captured']);
        // The export is over: the lock is still the measurement's, and a new export is not "already in progress".
        expect(isExportActive()).toBe(false);
        expect(exportCancellationState.renderLock?.holder).toBe('agent-measurement');

        startedRender(0).finish();
        await measurement;
        expect(exportCancellationState.renderLock).toBeNull();
    });

    it('stops waiting when the musician cancels, and leaves no raised cancel flag behind', async () => {
        mocks.honoursStop.value = false;
        const measurement = outcomeOf(
            executeOfflineRender(capturing('measurement'), { lockHolder: 'agent-measurement' })
        );
        await renderStarted(1);
        const musician = outcomeOf(executeOfflineRender(capturing('export')));

        cancelExport();

        expect(await musician).toMatchObject({ error: { _tag: 'Export', message: 'Export cancelled' } });
        expect(exportCancellationState.cancelFlag).toBe(false);
        expect(isExportActive()).toBe(false);
        expect(mocks.events).toEqual(['measurement-captured']);

        startedRender(0).finish();
        await measurement;
    });
});

describe('executeOfflineRender — a musician export outranks an agent section render', () => {
    it('stops the section render with a busy error worded for it, then renders the export without an error', async () => {
        const section = outcomeOf(executeOfflineRender(capturing('section'), { lockHolder: 'agent-section-render' }));
        await renderStarted(1);

        const musician = outcomeOf(executeOfflineRender(capturing('export')));
        const sectionOutcome = (await section) as { error: unknown };

        expect(isRenderBusyError(sectionOutcome.error)).toBe(true);
        expect(sectionOutcome.error).toMatchObject({
            message: "The assistant's render stopped because an export started.",
        });
        expect(exportCancellationState.cancelFlag).toBe(false);

        await renderStarted(2);
        expect(mocks.events).toEqual([
            'section-captured',
            'render-0-stopped',
            'render-released-resources',
            'export-captured',
        ]);
        expect(startedRender(1).abortSignal).toBeUndefined();

        startedRender(1).finish();
        expect(await musician).toEqual({ buffer: expect.objectContaining({ label: 'render-1' }) });
        expect(isExportActive()).toBe(false);
    });

    it('lets the section render own stop win over the busy refusal', async () => {
        const stop = new AbortController();
        const section = outcomeOf(
            executeOfflineRender(capturing('section'), { lockHolder: 'agent-section-render', abortSignal: stop.signal })
        );
        await renderStarted(1);

        stop.abort();
        const musician = outcomeOf(executeOfflineRender(capturing('export')));
        const sectionOutcome = (await section) as { error: unknown };

        expect(isRenderBusyError(sectionOutcome.error)).toBe(false);
        await renderStarted(2);
        startedRender(1).finish();
        await musician;
    });

    it('refuses a second export with the message it always had while the first waits for a section render', async () => {
        mocks.honoursStop.value = false;
        const section = outcomeOf(executeOfflineRender(capturing('section'), { lockHolder: 'agent-section-render' }));
        await renderStarted(1);

        const first = outcomeOf(executeOfflineRender(capturing('first-export')));
        const second = (await outcomeOf(executeOfflineRender(capturing('second-export')))) as { error: unknown };

        expect(second.error).toMatchObject({
            _tag: 'Export',
            message: 'An export is already in progress. Cancel the current export before starting a new one.',
        });
        expect(isExportActive()).toBe(true);

        cancelExport();
        expect(await first).toMatchObject({ error: { message: 'Export cancelled' } });
        startedRender(0).finish();
        await section;
    });

    it('refuses the section render as render-busy before capturing while a musician export renders', async () => {
        const musician = outcomeOf(executeOfflineRender(capturing('export')));
        await renderStarted(1);

        const section = (await outcomeOf(
            executeOfflineRender(capturing('section'), { lockHolder: 'agent-section-render' })
        )) as { error: unknown };

        expect(isRenderBusyError(section.error)).toBe(true);
        expect(mocks.events).toEqual(['export-captured']);
        expect(startedRender(0).abortSignal?.aborted ?? false).toBe(false);

        startedRender(0).finish();
        await musician;
    });

    it('fails the export naming the render once the release bound passes, and renders nothing', async () => {
        vi.useFakeTimers();
        mocks.honoursStop.value = false;
        const section = outcomeOf(executeOfflineRender(capturing('section'), { lockHolder: 'agent-section-render' }));
        await renderStarted(1);

        const musician = outcomeOf(executeOfflineRender(capturing('export')));
        await vi.advanceTimersByTimeAsync(RENDER_RELEASE_TIMEOUT_MS);
        const failure = (await musician) as { error: unknown };

        expect(failure.error).toMatchObject({
            _tag: 'Export',
            message:
                "The assistant's render did not stop in time to start this export. Try the export again in a moment.",
        });
        expect(mocks.events).toEqual(['section-captured']);
        expect(exportCancellationState.renderLock?.holder).toBe('agent-section-render');

        startedRender(0).finish();
        await section;
    });
});

describe('executeOfflineRender — agent renders never preempt one another', () => {
    it('refuses a section render as render-busy while a measurement renders, and leaves the measurement running', async () => {
        const measurement = outcomeOf(
            executeOfflineRender(capturing('measurement'), { lockHolder: 'agent-measurement' })
        );
        await renderStarted(1);

        const section = (await outcomeOf(
            executeOfflineRender(capturing('section'), { lockHolder: 'agent-section-render' })
        )) as { error: unknown };

        expect(isRenderBusyError(section.error)).toBe(true);
        expect(mocks.events).toEqual(['measurement-captured']);
        expect(startedRender(0).abortSignal?.aborted ?? false).toBe(false);
        expect(exportCancellationState.renderLock?.holder).toBe('agent-measurement');

        startedRender(0).finish();
        expect(await measurement).toMatchObject({ buffer: expect.objectContaining({ label: 'render-0' }) });
    });

    it('refuses a measurement as render-busy while a section render renders, and leaves the section render running', async () => {
        const section = outcomeOf(executeOfflineRender(capturing('section'), { lockHolder: 'agent-section-render' }));
        await renderStarted(1);

        const measurement = (await outcomeOf(
            executeOfflineRender(capturing('measurement'), { lockHolder: 'agent-measurement' })
        )) as { error: unknown };

        expect(isRenderBusyError(measurement.error)).toBe(true);
        expect(mocks.events).toEqual(['section-captured']);
        expect(startedRender(0).abortSignal?.aborted ?? false).toBe(false);
        expect(exportCancellationState.renderLock?.holder).toBe('agent-section-render');

        startedRender(0).finish();
        expect(await section).toMatchObject({ buffer: expect.objectContaining({ label: 'render-0' }) });
    });
});

describe("executeOfflineRender — a musician's Cancel stops only the musician's own export", () => {
    it.each(['agent-measurement', 'agent-section-render'] as const)(
        'leaves an assistant render (%s) running to completion when no export of theirs runs or waits',
        async (holder) => {
            const scopeBefore = exportCancellationState.controller;
            const assistant = outcomeOf(executeOfflineRender(capturing('assistant'), { lockHolder: holder }));
            await renderStarted(1);

            cancelExport();

            expect(exportCancellationState.cancelFlag).toBe(false);
            expect(startedRender(0).abortSignal?.aborted).toBe(false);
            expect(mocks.cancellationSignals[0]?.aborted).toBe(false);
            expect(() => checkCancel()).not.toThrow();

            startedRender(0).finish();
            expect(await assistant).toMatchObject({ buffer: expect.objectContaining({ label: 'render-0' }) });
            // The assistant's render opened and closed no export cancellation scope.
            expect(exportCancellationState.controller).toBe(scopeBefore);
            expect(exportCancellationState.renderLock).toBeNull();
        }
    );

    it("cancels the musician's own export, aborting the scope its instrument setup stops on", async () => {
        const musician = outcomeOf(executeOfflineRender(capturing('export')));
        await renderStarted(1);
        expect(mocks.cancellationSignals[0]?.aborted).toBe(false);

        cancelExport();

        expect(exportCancellationState.cancelFlag).toBe(true);
        expect(mocks.cancellationSignals[0]?.aborted).toBe(true);
        expect(() => checkCancel()).toThrow('Export cancelled');

        startedRender(0).fail(createExportError('Export cancelled'));
        expect(await musician).toMatchObject({ error: { message: 'Export cancelled' } });
    });

    it('lowers the flag its Cancel raised once the export settles, so a later assistant render is not stopped by it', async () => {
        const musician = outcomeOf(executeOfflineRender(capturing('export')));
        await renderStarted(1);
        cancelExport();
        startedRender(0).fail(createExportError('Export cancelled'));
        await musician;

        expect(exportCancellationState.cancelFlag).toBe(false);
        expect(exportCancellationState.controller.signal.aborted).toBe(false);
        expect(() => checkCancel()).not.toThrow();

        const assistant = outcomeOf(
            executeOfflineRender(capturing('measurement'), { lockHolder: 'agent-measurement' })
        );
        await renderStarted(2);
        startedRender(1).finish();
        expect(await assistant).toMatchObject({ buffer: expect.objectContaining({ label: 'render-1' }) });
    });

    it('lowers the flag when a cancelled export still renders to the end', async () => {
        const musician = outcomeOf(executeOfflineRender(capturing('export')));
        await renderStarted(1);
        cancelExport();

        startedRender(0).finish();
        await musician;

        expect(exportCancellationState.cancelFlag).toBe(false);
        expect(exportCancellationState.controller.signal.aborted).toBe(false);
    });

    it('pressed with no render holding the lock, raises nothing for the next assistant render to read', async () => {
        cancelExport();

        const assistant = outcomeOf(
            executeOfflineRender(capturing('measurement'), { lockHolder: 'agent-measurement' })
        );
        await renderStarted(1);

        expect(exportCancellationState.cancelFlag).toBe(false);
        expect(mocks.cancellationSignals[0]?.aborted).toBe(false);
        startedRender(0).finish();
        expect(await assistant).toMatchObject({ buffer: expect.objectContaining({ label: 'render-0' }) });
    });
});
