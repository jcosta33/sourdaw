import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { timeSignatureMapStore as realMeterMap } from '#/modules/Transport/stores/timeSignatureMapStore';
import { transportStore as realTransport } from '#/modules/Transport/stores/transportStore';

import { useSelectionLabel } from '../useSelectionLabel';

type ClipSelection = { selectedClipIds: string[] };
type TrackShape = { clips: Array<{ id: string; startBeat: number; endBeat: number }> };

const clipSelection = vi.hoisted(() => ({ value: null as ClipSelection | null }));
const trackState = vi.hoisted(() => ({ value: null as { tracks: TrackShape[] } | null }));
const clipSubscribers = vi.hoisted(() => new Set<() => void>());
const trackSubscribers = vi.hoisted(() => new Set<() => void>());
const transportSubscribers = vi.hoisted(() => new Set<() => void>());
const transportState = vi.hoisted(() => ({ value: null as { timeSignatureNumerator: number } | null }));

vi.mock('#/modules/Transport/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/stores')>()),
    timeSignatureMapStore: {
        subscribe: vi.fn((cb: () => void) => {
            transportSubscribers.add(cb);
            return () => {
                transportSubscribers.delete(cb);
            };
        }),
    },
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

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
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
        realTransport.set({ ...realTransport.value!, timeSignatureNumerator: 4, timeSignatureDenominator: 4 });
        realMeterMap.set({ changes: [] });
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

    it('reads a partial-bar length as bars.beats.sixteenths of duration', () => {
        clipSelection.value = { selectedClipIds: ['clip-c'] };
        trackState.value = {
            tracks: [{ clips: [{ id: 'clip-c', startBeat: 0, endBeat: 3 }] }],
        };

        const { result } = renderHook(() => useSelectionLabel());

        expect(result.current).toBe('1 clip · 0.3.0');
    });

    it('rounds a recorded clip length to the nearest sixteenth', () => {
        clipSelection.value = { selectedClipIds: ['clip-r'] };
        trackState.value = {
            tracks: [{ clips: [{ id: 'clip-r', startBeat: 31.666666666666668, endBeat: 35.54133333333297 }] }],
        };

        const { result } = renderHook(() => useSelectionLabel());

        expect(result.current).toBe('1 clip · 0.3.3');
    });

    it('reports a generic count when the clip id is not found in the tracks', () => {
        clipSelection.value = { selectedClipIds: ['missing'] };
        trackState.value = { tracks: [{ clips: [] }] };

        const { result } = renderHook(() => useSelectionLabel());

        expect(result.current).toBe('1 clip');
    });

    it('measures bars against the project time signature, not a fixed 4 (3/4)', () => {
        realTransport.set({ ...realTransport.value!, timeSignatureNumerator: 3, timeSignatureDenominator: 4 });
        clipSelection.value = { selectedClipIds: ['clip-e'] };
        trackState.value = {
            tracks: [{ clips: [{ id: 'clip-e', startBeat: 0, endBeat: 9 }] }],
        };

        const { result } = renderHook(() => useSelectionLabel());

        expect(result.current).toBe('1 clip · 3 bars');
    });

    it('reads 4 beats as 1 bar and 1 beat in 3/4', () => {
        realTransport.set({ ...realTransport.value!, timeSignatureNumerator: 3, timeSignatureDenominator: 4 });
        clipSelection.value = { selectedClipIds: ['clip-f'] };
        trackState.value = {
            tracks: [{ clips: [{ id: 'clip-f', startBeat: 0, endBeat: 4 }] }],
        };

        const { result } = renderHook(() => useSelectionLabel());

        expect(result.current).toBe('1 clip · 1.1.0');
    });

    it('sizes a bar by the meter change governing the clip start', () => {
        realMeterMap.set({ changes: [{ id: 'ts-1', beat: 8, numerator: 3, denominator: 4 }] });
        clipSelection.value = { selectedClipIds: ['clip-m'] };
        trackState.value = {
            tracks: [{ clips: [{ id: 'clip-m', startBeat: 8, endBeat: 17 }] }],
        };

        const { result } = renderHook(() => useSelectionLabel());

        expect(result.current).toBe('1 clip · 3 bars');
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
