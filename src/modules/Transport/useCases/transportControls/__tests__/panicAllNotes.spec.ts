import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ order: [] as string[] }));

const stop_all_scheduled = vi.hoisted(() =>
    vi.fn(() => {
        calls.order.push('stopAllScheduled');
    })
);
const panic_live_notes = vi.hoisted(() =>
    vi.fn(() => {
        calls.order.push('panicLiveNotes');
    })
);
const panic_crumbs = vi.hoisted(() =>
    vi.fn(() => {
        calls.order.push('panicCrumbs');
        return Promise.resolve();
    })
);
const panic_yeast_runtime = vi.hoisted(() =>
    vi.fn(() => {
        calls.order.push('panicYeastRuntime');
        return Promise.resolve();
    })
);

vi.mock('#/modules/AudioEngine/useCases', () => ({ stopAllScheduled: stop_all_scheduled }));
vi.mock('#/modules/MIDI/useCases', () => ({ panicLiveNotes: panic_live_notes }));
vi.mock('#/modules/Crumbs/useCases', () => ({ panicCrumbs: panic_crumbs }));
vi.mock('../panicYeastRuntime', () => ({ panicYeastRuntime: panic_yeast_runtime }));

const { panicAllNotes } = await import('../panicAllNotes');

describe('panicAllNotes', () => {
    beforeEach(() => {
        calls.order.length = 0;
        stop_all_scheduled.mockClear();
        panic_live_notes.mockClear();
        panic_crumbs.mockClear();
        panic_yeast_runtime.mockClear();
    });

    // audit MD-6 — a voice can live in four places that do not know about each
    // other. A panic that reaches only some of them is not a panic.
    it('reaches the live MIDI map, the audio graph, the Yeast runtime and Crumbs', async () => {
        await panicAllNotes();

        expect(calls.order).toEqual(['panicLiveNotes', 'stopAllScheduled', 'panicYeastRuntime', 'panicCrumbs']);
    });

    it('resolves only after the asynchronous Yeast and Crumbs releases settle', async () => {
        let releaseYeast: (() => void) | undefined;
        panic_yeast_runtime.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    releaseYeast = () => {
                        calls.order.push('panicYeastRuntime');
                        resolve();
                    };
                })
        );

        const pending = panicAllNotes();
        expect(panic_crumbs).not.toHaveBeenCalled();

        releaseYeast?.();
        await pending;

        expect(panic_crumbs).toHaveBeenCalledTimes(1);
    });

    it('propagates a failed release rather than reporting a panic that did not happen', async () => {
        const failure = new Error('worker gone');
        panic_yeast_runtime.mockImplementationOnce(() => Promise.reject(failure));

        await expect(panicAllNotes()).rejects.toBe(failure);
    });
});
