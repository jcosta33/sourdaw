import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { desktopInvoke, isDesktopRuntime } from '#/utils/desktopBridge';

import { PLUGIN_TAIL_READ_DEADLINE_MS, readPluginTails } from '../readPluginTails';

vi.mock('#/utils/desktopBridge', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/utils/desktopBridge')>()),
    isDesktopRuntime: vi.fn(),
    desktopInvoke: vi.fn(),
}));

describe('readPluginTails', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
    });

    it('invokes read_plugin_tails with the instance ids under the camelCase key the seam maps to the addon', async () => {
        vi.mocked(desktopInvoke).mockResolvedValue([]);

        await readPluginTails(['inst-1', 'inst-2']);

        expect(desktopInvoke).toHaveBeenCalledTimes(1);
        expect(desktopInvoke).toHaveBeenCalledWith('read_plugin_tails', { instanceIds: ['inst-1', 'inst-2'] });
    });

    it('passes valid readings through, in the order the host answered', async () => {
        const readings = [
            { instance_id: 'inst-2', tail_samples: 240_000, sequence: 4 },
            { instance_id: 'inst-1', tail_samples: 0, sequence: 3 },
        ];
        vi.mocked(desktopInvoke).mockResolvedValue(readings);

        await expect(readPluginTails(['inst-1', 'inst-2'])).resolves.toEqual({ kind: 'answered', readings });
    });

    it.each([
        ['an instance id that is not a string', { instance_id: 7, tail_samples: 100, sequence: 1 }],
        ['a tail that is not a number', { instance_id: 'bad', tail_samples: '100', sequence: 1 }],
        ['a negative tail', { instance_id: 'bad', tail_samples: -1, sequence: 1 }],
        ['a fractional tail', { instance_id: 'bad', tail_samples: 1.5, sequence: 1 }],
        ['a missing tail', { instance_id: 'bad', sequence: 1 }],
        ['a missing sequence', { instance_id: 'bad', tail_samples: 100 }],
        ['a fractional sequence', { instance_id: 'bad', tail_samples: 100, sequence: 1.5 }],
        ['a string sequence', { instance_id: 'bad', tail_samples: 100, sequence: '1' }],
        ['a zero sequence', { instance_id: 'bad', tail_samples: 100, sequence: 0 }],
        ['null', null],
        ['a bare string', 'inst-1'],
    ])('drops %s and keeps the valid reading beside it', async (_name, malformed) => {
        const valid = { instance_id: 'inst-1', tail_samples: 48_000, sequence: 2 };
        vi.mocked(desktopInvoke).mockResolvedValue([malformed, valid]);

        await expect(readPluginTails(['inst-1'])).resolves.toEqual({ kind: 'answered', readings: [valid] });
    });

    it.each([
        ['an object', { instance_id: 'inst-1', tail_samples: 1, sequence: 1 }],
        ['null', null],
        ['undefined', undefined],
    ])('rejects when the host answers %s instead of a list', async (_name, answer) => {
        vi.mocked(desktopInvoke).mockResolvedValue(answer);

        await expect(readPluginTails(['inst-1'])).rejects.toThrow(TypeError);
    });

    it('answers an empty list from the host as an answer, not a timeout', async () => {
        vi.mocked(desktopInvoke).mockResolvedValue([]);

        await expect(readPluginTails(['inst-1'])).resolves.toEqual({ kind: 'answered', readings: [] });
    });

    it('answers an empty list in a browser runtime without invoking the host', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(false);

        await expect(readPluginTails(['inst-1'])).resolves.toEqual({ kind: 'answered', readings: [] });
        expect(desktopInvoke).not.toHaveBeenCalled();
    });

    describe('when the host does not answer', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('reports a timeout, distinct from an empty answer, once the deadline passes, after exactly one invoke', async () => {
            vi.mocked(desktopInvoke).mockReturnValue(new Promise(() => {}));
            let outcome: unknown = 'pending';
            void readPluginTails(['inst-1']).then((readings) => {
                outcome = readings;
                return readings;
            });

            await vi.advanceTimersByTimeAsync(PLUGIN_TAIL_READ_DEADLINE_MS - 1);
            expect(outcome).toBe('pending');
            await vi.advanceTimersByTimeAsync(1);

            expect(outcome).toEqual({ kind: 'timed-out' });
            expect(desktopInvoke).toHaveBeenCalledTimes(1);
        });

        it("answers the host's readings when they come before the deadline, leaving no timer behind", async () => {
            const readings = [{ instance_id: 'inst-1', tail_samples: 48_000, sequence: 2 }];
            vi.mocked(desktopInvoke).mockResolvedValue(readings);

            await expect(readPluginTails(['inst-1'])).resolves.toEqual({ kind: 'answered', readings });

            expect(vi.getTimerCount()).toBe(0);
        });

        it('does not surface the rejection of a call the deadline already gave up on', async () => {
            const late = Promise.withResolvers<unknown>();
            vi.mocked(desktopInvoke).mockReturnValue(late.promise);
            const read = readPluginTails(['inst-1']);
            await vi.advanceTimersByTimeAsync(PLUGIN_TAIL_READ_DEADLINE_MS);
            await expect(read).resolves.toEqual({ kind: 'timed-out' });

            late.reject(new Error('host finally failed'));
            await vi.advanceTimersByTimeAsync(0);
        });
    });
});
