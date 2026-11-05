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
const meterSubscribers = vi.hoisted(() => new Set<() => void>());
type TransportMeter = { timeSignatureNumerator: number; timeSignatureDenominator: number };
const transportState = vi.hoisted(() => ({ value: null as TransportMeter | null }));
const meterMap = vi.hoisted(() => ({
    value: { changes: [] } as { changes: { id: string; beat: number; numerator: number; denominator: number }[] },
}));

vi.mock('#/modules/Transport/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/stores')>()),
    timeSignatureMapStore: {
        get value() {
            return meterMap.value;
        },
        subscribe: vi.fn((cb: () => void) => {
            meterSubscribers.add(cb);
            return () => {
                meterSubscribers.delete(cb);
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
        transportState.value = { timeSignatureNumerator: 4, timeSignatureDenominator: 4 };
        meterMap.value = { changes: [] };
        clipSubscribers.clear();
        trackSubscribers.clear();
        transportSubscribers.clear();
        meterSubscribers.clear();
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

    it('floors a recorded clip length to the sixteenth it reaches', () => {
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
        transportState.value = { timeSignatureNumerator: 3, timeSignatureDenominator: 4 };
        clipSelection.value = { selectedClipIds: ['clip-e'] };
        trackState.value = {
            tracks: [{ clips: [{ id: 'clip-e', startBeat: 0, endBeat: 9 }] }],
        };

        const { result } = renderHook(() => useSelectionLabel());

        expect(result.current).toBe('1 clip · 3 bars');
    });

    it('reads 4 beats as 1 bar and 1 beat in 3/4', () => {
        transportState.value = { timeSignatureNumerator: 3, timeSignatureDenominator: 4 };
        clipSelection.value = { selectedClipIds: ['clip-f'] };
        trackState.value = {
            tracks: [{ clips: [{ id: 'clip-f', startBeat: 0, endBeat: 4 }] }],
        };

        const { result } = renderHook(() => useSelectionLabel());

        expect(result.current).toBe('1 clip · 1.1.0');
    });

    it('counts each bar of a clip spanning a meter change in its own meter', () => {
        meterMap.value = { changes: [{ id: 'ts-1', beat: 8, numerator: 3, denominator: 4 }] };
        clipSelection.value = { selectedClipIds: ['clip-m'] };
        trackState.value = {
            tracks: [{ clips: [{ id: 'clip-m', startBeat: 0, endBeat: 12 }] }],
        };

        const { result } = renderHook(() => useSelectionLabel());

        // Two 4/4 bars, one 3/4 bar and one beat; a flat 4/4 reading would say 3 bars.
        expect(result.current).toBe('1 clip · 3.1.0');
    });

    it('re-derives the label when only the meter map changes', () => {
        clipSelection.value = { selectedClipIds: ['clip-n'] };
        trackState.value = {
            tracks: [{ clips: [{ id: 'clip-n', startBeat: 0, endBeat: 9 }] }],
        };
        const { result } = renderHook(() => useSelectionLabel());
        expect(result.current).toBe('1 clip · 2.1.0');

        meterMap.value = { changes: [{ id: 'ts-1', beat: 0, numerator: 3, denominator: 4 }] };
        act(() => {
            for (const cb of meterSubscribers) {
                cb();
            }
        });

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
