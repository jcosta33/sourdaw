import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { snapToGridOrClips } from './snapToGridOrClips';

describe('snapToGridOrClips', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('snaps to a nearby clip edge before grid', () => {
        injectDependencies(snapToGridOrClips, {
            trackStore: {
                value: {
                    tracks: [
                        {
                            id: 't1',
                            clips: [
                                { id: 'a', startBeat: 0, endBeat: 4 },
                                { id: 'b', startBeat: 8, endBeat: 12 },
                            ],
                        },
                    ],
                    selectedTrackId: null,
                },
                set: vi.fn(),
            } as never,
            snapToGrid: vi.fn(() => 99),
        });

        expect(snapToGridOrClips(0.1, 't1')).toBe(0);
        expect(snapToGridOrClips(3.9, 't1')).toBe(4);
    });

    it('excludes a clip id from edge snapping', () => {
        injectDependencies(snapToGridOrClips, {
            trackStore: {
                value: {
                    tracks: [
                        {
                            id: 't1',
                            clips: [{ id: 'only', startBeat: 0, endBeat: 4 }],
                        },
                    ],
                    selectedTrackId: null,
                },
                set: vi.fn(),
            } as never,
            snapToGrid: vi.fn((beat: number) => beat),
        });

        expect(snapToGridOrClips(0.1, 't1', 'only')).toBe(0.1);
    });

    it('delegates to snapToGrid when no clip edge matches', () => {
        const snapToGrid = vi.fn((beat: number) => Math.round(beat));
        injectDependencies(snapToGridOrClips, {
            trackStore: {
                value: {
                    tracks: [{ id: 't1', clips: [] }],
                    selectedTrackId: null,
                },
                set: vi.fn(),
            } as never,
            snapToGrid,
        });

        expect(snapToGridOrClips(1.4, 't1')).toBe(1);
        expect(snapToGrid).toHaveBeenCalledWith(1.4);
    });
});
