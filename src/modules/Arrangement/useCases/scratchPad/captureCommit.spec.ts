import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { captureArrangementToScratchPad, commitScratchPadToArrangement } from './captureCommit';

describe('captureArrangementToScratchPad', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('copies sorted arrangement sections into the scratch pad store', () => {
        const setPad = vi.fn();
        injectDependencies(captureArrangementToScratchPad, {
            markerStore: {
                value: {
                    markers: [],
                    sections: [
                        { id: 's2', startBeat: 8, endBeat: 16, name: 'B', color: '#00f' },
                        { id: 's1', startBeat: 0, endBeat: 4, name: 'A', color: '#f00' },
                    ],
                },
                set: vi.fn(),
            } as never,
            scratchPadStore: {
                value: { sections: [] },
                set: setPad,
            } as never,
        });

        captureArrangementToScratchPad();

        expect(setPad).toHaveBeenCalledTimes(1);
        const next = setPad.mock.calls[0]![0] as { sections: { name: string; startBeat: number }[] };
        expect(next.sections).toHaveLength(2);
        expect(next.sections[0]!.name).toBe('A');
        expect(next.sections[1]!.name).toBe('B');
    });

    it('no-ops when there are no sections', () => {
        const setPad = vi.fn();
        injectDependencies(captureArrangementToScratchPad, {
            markerStore: {
                value: { markers: [], sections: [] },
                set: vi.fn(),
            } as never,
            scratchPadStore: {
                value: { sections: [] },
                set: setPad,
            } as never,
        });

        captureArrangementToScratchPad();
        expect(setPad).not.toHaveBeenCalled();
    });
});

describe('commitScratchPadToArrangement', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('writes scratch sections back to the marker store', () => {
        const setMarkers = vi.fn();
        injectDependencies(commitScratchPadToArrangement, {
            scratchPadStore: {
                value: {
                    sections: [
                        {
                            id: 'sp1',
                            startBeat: 0,
                            endBeat: 4,
                            name: 'A',
                            color: '#f00',
                            order: 0,
                        },
                    ],
                },
                set: vi.fn(),
            } as never,
            markerStore: {
                value: {
                    markers: [],
                    sections: [{ id: 'old', startBeat: 99, endBeat: 100, name: 'X', color: '#000' }],
                },
                set: setMarkers,
            } as never,
        });

        commitScratchPadToArrangement();

        expect(setMarkers).toHaveBeenCalledTimes(1);
        const next = setMarkers.mock.calls[0]![0] as { sections: { name: string; startBeat: number }[] };
        expect(next.sections).toHaveLength(1);
        expect(next.sections[0]!.name).toBe('A');
        expect(next.sections[0]!.startBeat).toBe(0);
    });
});
