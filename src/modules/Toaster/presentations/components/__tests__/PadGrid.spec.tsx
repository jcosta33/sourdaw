import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';

import { type PadState } from '../../../models/ToasterKit';
import { PadGrid } from '../PadGrid';

function makePad(index: number): PadState {
    return {
        id: index,
        name: `P${index}`,
        color: '#e06060',
        engineType: 'kick-808',
        chokeGroup: 0,
        midiNote: 36 + index,
        volume: 0.8,
        pan: 0,
        muted: false,
        soloed: false,
        tune: 0,
        decay: 0.5,
        tone: 0.5,
        drive: 0,
        filterCutoff: 20000,
        filterResonance: 1,
        sendReverb: 0,
        sendDelay: 0,
        engineParams: {},
    };
}

describe('PadGrid (Toaster)', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('should render', () => {
        const pads = Array.from({ length: 8 }, (_, index) => makePad(index));
        render(<PadGrid pads={pads} selectedIndex={0} onSelectPad={vi.fn()} onTriggerPad={vi.fn()} />);
        expect(screen.getByText('P0')).toBeInTheDocument();
    });

    it('should trigger a pad from the keyboard via Enter and Space', () => {
        const onTriggerPad = vi.fn();
        const pads = Array.from({ length: 4 }, (_, index) => makePad(index));
        render(<PadGrid pads={pads} selectedIndex={0} onSelectPad={vi.fn()} onTriggerPad={onTriggerPad} />);

        const pad1 = screen.getByRole('button', { name: /trigger p1/i });
        fireEvent.keyDown(pad1, { key: 'Enter' });
        expect(onTriggerPad).toHaveBeenCalledWith(1);

        onTriggerPad.mockClear();
        fireEvent.keyDown(pad1, { key: ' ' });
        expect(onTriggerPad).toHaveBeenCalledWith(1);
    });

    it('should not re-trigger on a held key repeat', () => {
        const onTriggerPad = vi.fn();
        const pads = Array.from({ length: 4 }, (_, index) => makePad(index));
        render(<PadGrid pads={pads} selectedIndex={0} onSelectPad={vi.fn()} onTriggerPad={onTriggerPad} />);

        const pad0 = screen.getByRole('button', { name: /trigger p0/i });
        fireEvent.keyDown(pad0, { key: 'Enter', repeat: true });
        expect(onTriggerPad).not.toHaveBeenCalled();
    });

    it('should clear a departed pad flash timer so it does not fire setState after the pad leaves', () => {
        vi.useFakeTimers();
        const onTriggerPad = vi.fn();
        const pads = Array.from({ length: 4 }, (_, index) => makePad(index));

        const { rerender } = render(
            <PadGrid pads={pads} selectedIndex={0} onSelectPad={vi.fn()} onTriggerPad={onTriggerPad} />
        );

        const isFlashing = (label: RegExp): boolean =>
            screen.getByRole('button', { name: label }).style.transform === 'scale(0.97)';

        // 1. Trigger pad 3 — it flashes and a 120ms unflash timer is now pending.
        act(() => {
            fireEvent.mouseDown(screen.getByRole('button', { name: /trigger p3/i }), { button: 0 });
        });
        expect(isFlashing(/trigger p3/i)).toBe(true);

        // 2. Pad 3 leaves the list before its timer fires. The fix prunes the
        //    pending timer here so it can never run its setFlashingPads callback.
        act(() => {
            rerender(
                <PadGrid pads={pads.slice(0, 3)} selectedIndex={0} onSelectPad={vi.fn()} onTriggerPad={onTriggerPad} />
            );
        });

        // 3. Re-add pad 3 (a fresh strip, no re-trigger) so its flash cell is
        //    observable again, then advance well past the original 120ms window.
        act(() => {
            rerender(<PadGrid pads={pads} selectedIndex={0} onSelectPad={vi.fn()} onTriggerPad={onTriggerPad} />);
            vi.advanceTimersByTime(200);
        });

        // With the timer pruned, the stale unflash callback never ran. Without
        // the fix, that orphaned timer fires at 120ms and deletes index 3 from
        // the flash set, so the re-added pad would read as not flashing here.
        expect(isFlashing(/trigger p3/i)).toBe(true);
    });
});
