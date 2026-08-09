import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { TempoEditor } from '../TempoEditor';

import type { TransportState } from '#/modules/Transport/stores';

/**
 * The tempo field's read-only lock, driven end to end.
 *
 * `ValueField.spec.tsx` covers the abort at the component's own layer, with
 * `readOnly` flipped by hand. It cannot observe what the abort is *for*: that
 * comes from the consumer, and only this composition shows it. Real
 * `TempoEditor`, real `useTempoEditorState`, real `resolveTempoFieldState`, real
 * `TempoMap` interpolation, real `ValueField`. Only the two store subscriptions,
 * the non-reactive playhead channel, the rAF clock and `executeAppAction` are
 * substituted — everything that decides what the field shows and whether it may
 * be written is the production code.
 *
 * `TempoEditor.spec.tsx` mocks both the hook and `ValueField`, so it asserts the
 * view's wiring and deliberately sees none of this.
 */

const { mockTransportStore, mockTempoMapStore, mockPlayheadPositionRef } = vi.hoisted(() => ({
    mockTransportStore: { name: 'transportStore' },
    mockTempoMapStore: { name: 'tempoMapStore' },
    // The scheduler's non-reactive high-frequency channel, written ~100×/s
    // outside React. Advancing the playhead means writing this, not the store.
    mockPlayheadPositionRef: { current: 0 },
}));

vi.mock('#/modules/Transport/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Transport/stores')>();
    return {
        ...actual,
        transportStore: mockTransportStore,
        tempoMapStore: mockTempoMapStore,
        playheadPositionRef: mockPlayheadPositionRef,
    };
});

const mockExecuteAppAction = vi.fn();
vi.mock('#/modules/Command/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Command/useCases')>();
    return {
        ...actual,
        executeAppAction: (...args: unknown[]): unknown => mockExecuteAppAction(...args),
    };
});

vi.mock('#/components/ui/tooltip', () => ({
    Tooltip: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    TooltipTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

type TempoChangeFixture = { id: string; beat: number; tempo: number; curve: 'instant' | 'linear' };

const baseTransportState: TransportState = {
    isPlaying: true,
    isRecording: false,
    isLooping: false,
    overdubEnabled: false,
    metronomeEnabled: false,
    metronomeVolume: 0.5,
    tempo: 120,
    timeSignatureNumerator: 4,
    timeSignatureDenominator: 4,
    playheadPosition: 0,
    loopStart: 0,
    loopEnd: 0,
    scheduleGrainMs: 10,
    punchInEnabled: false,
    punchInBeat: 0,
    punchOutBeat: 16,
    countInEnabled: false,
    countInBars: 1,
    preRollEnabled: false,
    preRollBars: 2,
    masterGain: 80,
};

/**
 * A descending ramp into an ascending one, so a playhead that only ever moves
 * forward produces a readout that moves in both directions. A monotonic readout
 * could be mistaken for a value frozen at one end of the range; this one cannot.
 *
 * `150 @0 --linear-> 110 @10 --linear-> 190 @20`, so the field reads 140 at beat
 * 2.5, 130 at beat 5, 150 at beat 15, and 190 at beat 20. Beats 0 and 20 sit on
 * an event's own beat, where the interpolation factor is 0 and the readout is
 * that event's value — the field is editable there. Everything strictly between
 * is interpolated, belongs to no single event, and is locked.
 */
const RAMP: TempoChangeFixture[] = [
    { id: 'tc-start', beat: 0, tempo: 150, curve: 'linear' },
    { id: 'tc-trough', beat: 10, tempo: 110, curve: 'linear' },
    { id: 'tc-end', beat: 20, tempo: 190, curve: 'instant' },
];

let transportState: TransportState = baseTransportState;
let tempoMapState: { changes: TempoChangeFixture[] } = { changes: RAMP };

// Mirrors the real `useStore`: `getSnapshot() ?? defaultValue`. The hook's
// null-defaulted second subscription to `transportStore` is how it tells an
// unhydrated store from a substituted default, so both must route through here.
vi.mock('#/infra/store/useStore', () => ({
    useStore: (store: unknown, defaultState: unknown): unknown => {
        if (store === mockTransportStore) {
            return transportState ?? defaultState;
        }
        if (store === mockTempoMapStore) {
            return tempoMapState;
        }
        throw new Error('TempoEditorRampAbort.spec: unexpected store passed to useStore');
    },
}));

let frameCallbacks: FrameRequestCallback[] = [];

/**
 * Advance the live playhead and let the hook's rAF loop observe it. The loop
 * re-arms itself on every callback, so pumping the queue once both runs the
 * pending frame and schedules the next.
 */
const advancePlayheadTo = (beat: number): void => {
    mockPlayheadPositionRef.current = beat;
    const due = frameCallbacks;
    frameCallbacks = [];
    act(() => {
        for (const callback of due) {
            callback(0);
        }
    });
};

describe('TempoEditor — a tempo drag aborted by the playhead entering a ramp', () => {
    beforeEach(() => {
        mockExecuteAppAction.mockClear();
        mockPlayheadPositionRef.current = 0;
        transportState = baseTransportState;
        tempoMapState = { changes: RAMP };
        frameCallbacks = [];
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
            frameCallbacks.push(callback);
            return frameCallbacks.length;
        });
        vi.stubGlobal('cancelAnimationFrame', (): void => {});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    const startDragAt = (field: HTMLElement): void => {
        fireEvent.pointerDown(field, { button: 0, pointerId: 71, clientY: 100 });
        // 20px up × 0.5 sensitivity × step 1 → +10 BPM held pending, because the
        // field runs `commitMode="release"`.
        fireEvent.pointerMove(field, { pointerId: 71, clientY: 80 });
    };

    it('should follow the ramp per frame once the lock aborts the drag, instead of freezing at the dragged-to value', () => {
        render(<TempoEditor />);
        const field = screen.getByRole('spinbutton');

        // Beat 0 is the ramp's own start point, so the field is writable and
        // reads that event's tempo.
        expect(field).toHaveAttribute('aria-readonly', 'false');
        expect(field).toHaveAttribute('aria-valuetext', '150 BPM');

        startDragAt(field);
        expect(field).toHaveAttribute('aria-valuetext', '160 BPM');

        // The playhead crosses into the ramp under the user's finger.
        advancePlayheadTo(2.5);
        expect(field).toHaveAttribute('aria-readonly', 'true');

        // This is the guarantee. `finalizeDrag` restores nothing — it drops the
        // pending value, and the readout falls through to the live `value` prop,
        // which is the ramp's interpolated tempo at the playhead. So the field
        // shows neither the pre-drag value nor the dragged-to value but the
        // truth, and goes on tracking it every frame.
        expect(field).toHaveAttribute('aria-valuetext', '140 BPM');

        advancePlayheadTo(5);
        expect(field).toHaveAttribute('aria-valuetext', '130 BPM');

        advancePlayheadTo(15);
        expect(field).toHaveAttribute('aria-valuetext', '150 BPM');

        // ...and it is still correct after the playhead leaves the ramp, where
        // the lock clears. Without the abort the field is frozen at 160 through
        // every one of these frames and stays frozen indefinitely, greying and
        // un-greying around a number nothing holds.
        advancePlayheadTo(20);
        expect(field).toHaveAttribute('aria-readonly', 'false');
        expect(field).toHaveAttribute('aria-valuetext', '190 BPM');
    });

    it('should write nothing when the aborted gesture is released after the ramp has ended', () => {
        // The consumer's own `if (!tempoField.editable) { return; }` guard does
        // not cover this: by the time the finger lifts the playhead has left the
        // ramp and the field is editable again, so a stale pending value from a
        // gesture aborted inside the ramp would pass straight through it and
        // overwrite the event governing the *new* playhead position.
        render(<TempoEditor />);
        const field = screen.getByRole('spinbutton');

        startDragAt(field);
        advancePlayheadTo(2.5);
        advancePlayheadTo(20);
        expect(field).toHaveAttribute('aria-readonly', 'false');

        fireEvent.pointerUp(field, { pointerId: 71 });

        expect(mockExecuteAppAction).not.toHaveBeenCalled();
        expect(field).toHaveAttribute('aria-valuetext', '190 BPM');
    });

    it('should write nothing when the aborted gesture is released while the ramp still holds', () => {
        render(<TempoEditor />);
        const field = screen.getByRole('spinbutton');

        startDragAt(field);
        advancePlayheadTo(5);

        fireEvent.pointerUp(field, { pointerId: 71 });

        expect(mockExecuteAppAction).not.toHaveBeenCalled();
        expect(field).toHaveAttribute('aria-valuetext', '130 BPM');
    });

    it('should accept a fresh drag once the playhead leaves the ramp, and write it to the event now governing', () => {
        // The abort must not strand the control: `handlePointerDown` refuses a
        // field that still records a pointer owner, so a half-cleared abort
        // would leave the tempo field dead for the rest of the session.
        render(<TempoEditor />);
        const field = screen.getByRole('spinbutton');

        startDragAt(field);
        advancePlayheadTo(5);
        advancePlayheadTo(20);

        fireEvent.pointerDown(field, { button: 0, pointerId: 72, clientY: 100 });
        fireEvent.pointerMove(field, { pointerId: 72, clientY: 90 });
        expect(field).toHaveAttribute('aria-valuetext', '195 BPM');

        fireEvent.pointerUp(field, { pointerId: 72 });

        expect(mockExecuteAppAction).toHaveBeenCalledExactlyOnceWith({
            type: 'setTempo',
            payload: { bpm: 195, tempoChangeId: 'tc-end' },
        });
    });
});
