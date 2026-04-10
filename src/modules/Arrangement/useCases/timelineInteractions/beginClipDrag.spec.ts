import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { beginClipDrag } from './beginClipDrag';

describe('beginClipDrag', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('returns drag state from hit test and clip bounds', () => {
        injectDependencies(beginClipDrag, {
            hitTestClip: vi.fn(() => ({ clipId: 'c1', trackId: 't1' })),
            timelineViewStore: {
                value: { pixelsPerBeat: 10, scrollX: 0, scrollY: 0 },
                set: vi.fn(),
            } as never,
            trackStore: {
                value: {
                    tracks: [
                        {
                            id: 't1',
                            clips: [{ id: 'c1', startBeat: 0, endBeat: 8 }],
                        },
                    ],
                    selectedTrackId: null,
                },
                set: vi.fn(),
            } as never,
        });

        const state = beginClipDrag(20, 12, 'move');
        expect(state).toEqual({
            clipId: 'c1',
            sourceTrackId: 't1',
            startBeat: 0,
            endBeat: 8,
            offsetBeat: 2,
            mode: 'move',
        });
    });

    it('returns null when hitTestClip misses', () => {
        injectDependencies(beginClipDrag, {
            hitTestClip: vi.fn(() => null),
            timelineViewStore: {
                value: { pixelsPerBeat: 10, scrollX: 0, scrollY: 0 },
                set: vi.fn(),
            } as never,
            trackStore: {
                value: { tracks: [], selectedTrackId: null },
                set: vi.fn(),
            } as never,
        });

        expect(beginClipDrag(0, 0)).toBeNull();
    });
});
