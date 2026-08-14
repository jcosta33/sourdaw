import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useSelectionLabel } from '../useSelectionLabel';

type ClipSelection = { selectedClipIds: string[] };
type TrackShape = { clips: Array<{ id: string; startBeat: number; endBeat: number }> };

const clipSelection = vi.hoisted(() => ({ value: null as ClipSelection | null }));
const trackState = vi.hoisted(() => ({ value: null as { tracks: TrackShape[] } | null }));
const clipSubscribers = vi.hoisted(() => new Set<() => void>());
const trackSubscribers = vi.hoisted(() => new Set<() => void>());
const transportSubscribers = vi.hoisted(() => new Set<() => void>());
const transportState = vi.hoisted(() => ({ value: null as { timeSignatureNumerator: number } | null }));

vi.mock('#/modules/Transport/stores', () => ({
    transportStore: {
        get value() {
            return transportState.value;
        },
        subscribe: vi.fn((cb: () => void) => {
            transportSubscribers.add(cb);
            return () => {
                transportSubscribers.delete(cb);
            };
        }),
        subscribeReact: vi.fn((cb: () => void) => {
            transportSubscribers.add(cb);
            return () => {
                transportSubscribers.delete(cb);
            };
        }),
        getSnapshot: () => transportState.value,
    },
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    clipSelectionStore: {
        get value() {
            return clipSelection.value;
        },
        subscribe: vi.fn((cb: () => void) => {
            clipSubscribers.add(cb);
            return () => {
                clipSubscribers.delete(cb);
            };
        }),
        subscribeReact: vi.fn((cb: () => void) => {
            clipSubscribers.add(cb);
            return () => {
                clipSubscribers.delete(cb);
            };
        }),
        getSnapshot: () => clipSelection.value,
    },
    trackStore: {
        get value() {
            return trackState.value;
        },
        subscribe: vi.fn((cb: () => void) => {
            trackSubscribers.add(cb);
            return () => {
                trackSubscribers.delete(cb);
            };
        }),
        subscribeReact: vi.fn((cb: () => void) => {
            trackSubscribers.add(cb);
            return () => {
                trackSubscribers.delete(cb);
            };
        }),
        getSnapshot: () => trackState.value,
    },
}));

function notify(): void {
    for (const cb of clipSubscribers) {
        cb();
    }
    for (const cb of trackSubscribers) {
        cb();
    }
    for (const cb of transportSubscribers) {
        cb();
    }
}

describe('useSelectionLabel', () => {
    beforeEach(() => {
        clipSelection.value = null;
        trackState.value = null;
        transportState.value = { timeSignatureNumerator: 4 };
        clipSubscribers.clear();
        trackSubscribers.clear();
        transportSubscribers.clear();
    });

    it('returns an empty label when no clips are selected', () => {
        clipSelection.value = { selectedClipIds: [] };

        const { result } = renderHook(() => useSelectionLabel());

        expect(result.current).toBe('');
    });

    it('returns an empty label when the selection is absent (nullish)', () => {
        const { result } = renderHook(() => useSelectionLabel());

        expect(result.current).toBe('');
    });

    it('labels a single selected clip of whole-bar length using bars', () => {
        // 4 beats = 1 bar exactly.
        clipSelection.value = { selectedClipIds: ['clip-a'] };
        trackState.value = {
            tracks: [{ clips: [{ id: 'clip-a', startBeat: 0, endBeat: 4 }] }],
        };

        const { result } = renderHook(() => useSelectionLabel());

        expect(result.current).toBe('1 clip · 1 bar');
    });

    it('pluralizes bars for a multi-bar clip (8 beats = 2 bars)', () => {
        clipSelection.value = { selectedClipIds: ['clip-b'] };
        trackState.value = {
            tracks: [{ clips: [{ id: 'clip-b', startBeat: 0, endBeat: 8 }] }],
        };

        const { result } = renderHook(() => useSelectionLabel());

        expect(result.current).toBe('1 clip · 2 bars');
    });

    it('falls back to beats when the clip length is not a whole number of bars', () => {
        // 3 beats / 4 = 0.75 bars → not integer → use beats form.
        clipSelection.value = { selectedClipIds: ['clip-c'] };
        trackState.value = {
            tracks: [{ clips: [{ id: 'clip-c', startBeat: 0, endBeat: 3 }] }],
        };

        const { result } = renderHook(() => useSelectionLabel());

        expect(result.current).toBe('1 clip · 3 beats');
    });

    it('uses the singular "beat" form for a 1-beat clip', () => {
        clipSelection.value = { selectedClipIds: ['clip-d'] };
        trackState.value = {
            tracks: [{ clips: [{ id: 'clip-d', startBeat: 0, endBeat: 1 }] }],
        };

        const { result } = renderHook(() => useSelectionLabel());

        // 1 beat is not a whole number of bars, and is exactly 1 → singular.
        expect(result.current).toBe('1 clip · 1 beat');
    });

    it('reports a generic count when the clip id is not found in the tracks', () => {
        clipSelection.value = { selectedClipIds: ['missing'] };
        trackState.value = { tracks: [{ clips: [] }] };

        const { result } = renderHook(() => useSelectionLabel());

        expect(result.current).toBe('1 clip');
    });

    it('measures bars against the transport time signature, not a fixed 4 (3/4)', () => {
        transportState.value = { timeSignatureNumerator: 3 };
        clipSelection.value = { selectedClipIds: ['clip-e'] };
        trackState.value = {
            tracks: [{ clips: [{ id: 'clip-e', startBeat: 0, endBeat: 9 }] }],
        };

        const { result } = renderHook(() => useSelectionLabel());

        // 9 beats in 3/4 is exactly 3 bars. Dividing by a literal 4 gives 2.25,
        // which is not an integer and degrades to "1 clip · 9 beats".
        expect(result.current).toBe('1 clip · 3 bars');
    });

    it('uses beats phrasing when the length is not a whole number of bars in 3/4', () => {
        transportState.value = { timeSignatureNumerator: 3 };
        clipSelection.value = { selectedClipIds: ['clip-f'] };
        trackState.value = {
            tracks: [{ clips: [{ id: 'clip-f', startBeat: 0, endBeat: 4 }] }],
        };

        const { result } = renderHook(() => useSelectionLabel());

        // 4 beats is one whole bar in 4/4 but 1⅓ bars in 3/4.
        expect(result.current).toBe('1 clip · 4 beats');
    });

    it('falls back to 4 beats per bar when transport state is unavailable', () => {
        transportState.value = null;
        clipSelection.value = { selectedClipIds: ['clip-g'] };
        trackState.value = {
            tracks: [{ clips: [{ id: 'clip-g', startBeat: 0, endBeat: 8 }] }],
        };

        const { result } = renderHook(() => useSelectionLabel());

        expect(result.current).toBe('1 clip · 2 bars');
    });

    it('counts multiple selected clips', () => {
        clipSelection.value = { selectedClipIds: ['a', 'b', 'c'] };

        const { result } = renderHook(() => useSelectionLabel());

        expect(result.current).toBe('3 clips selected');
    });

    it('re-derives the label when the clip selection changes', () => {
        clipSelection.value = { selectedClipIds: [] };
        const { result, rerender } = renderHook(() => useSelectionLabel());
        expect(result.current).toBe('');

        clipSelection.value = { selectedClipIds: ['a', 'b'] };
        act(() => {
            notify();
            rerender();
        });

        expect(result.current).toBe('2 clips selected');
    });
});
