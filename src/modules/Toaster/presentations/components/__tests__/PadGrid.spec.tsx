import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';

import { type PadState } from '../../../models/ToasterKit';
import { PadGrid } from '../PadGrid';

function makePad(index: number, overrides: Partial<PadState> = {}): PadState {
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
        ...overrides,
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
        expect(screen.getByText('P0')).toBeTruthy();
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

    it('should clear a departed pad flash timer', () => {
        vi.useFakeTimers();
        const onTriggerPad = vi.fn();
        const pads = Array.from({ length: 4 }, (_, index) => makePad(index));
        const { rerender } = render(
            <PadGrid pads={pads} selectedIndex={0} onSelectPad={vi.fn()} onTriggerPad={onTriggerPad} />
        );
        const isFlashing = (label: RegExp): boolean =>
            screen.getByRole('button', { name: label }).style.transform === 'scale(0.97)';
        act(() => {
            fireEvent.mouseDown(screen.getByRole('button', { name: /trigger p3/i }), { button: 0 });
        });
        expect(isFlashing(/trigger p3/i)).toBe(true);
        act(() => {
            rerender(
                <PadGrid pads={pads.slice(0, 3)} selectedIndex={0} onSelectPad={vi.fn()} onTriggerPad={onTriggerPad} />
            );
        });
        act(() => {
            rerender(<PadGrid pads={pads} selectedIndex={0} onSelectPad={vi.fn()} onTriggerPad={onTriggerPad} />);
            vi.advanceTimersByTime(200);
        });
        expect(isFlashing(/trigger p3/i)).toBe(true);
    });
});

describe('PadGrid — selection and aria', () => {
    it('fires onSelectPad when a pad is clicked', () => {
        const onSelectPad = vi.fn();
        const pads = Array.from({ length: 4 }, (_, index) => makePad(index));
        render(<PadGrid pads={pads} selectedIndex={0} onSelectPad={onSelectPad} onTriggerPad={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /trigger p2/i }));
        expect(onSelectPad).toHaveBeenCalledWith(2);
    });

    it('shows aria-pressed true on the selected pad', () => {
        const pads = Array.from({ length: 4 }, (_, index) => makePad(index));
        render(<PadGrid pads={pads} selectedIndex={1} onSelectPad={vi.fn()} onTriggerPad={vi.fn()} />);
        expect(screen.getByRole('button', { name: /trigger p1/i })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: /trigger p0/i })).toHaveAttribute('aria-pressed', 'false');
    });
});

describe('PadGrid — pad state display', () => {
    it('shows Mute overlay when pad is muted', () => {
        const pads = [makePad(0, { muted: true })];
        render(<PadGrid pads={pads} selectedIndex={0} onSelectPad={vi.fn()} onTriggerPad={vi.fn()} />);
        expect(screen.getByText('Mute')).toBeTruthy();
    });

    it('does not show Mute overlay when pad is not muted', () => {
        const pads = [makePad(0, { muted: false })];
        render(<PadGrid pads={pads} selectedIndex={0} onSelectPad={vi.fn()} onTriggerPad={vi.fn()} />);
        expect(screen.queryByText('Mute')).toBeNull();
    });

    it('shows choke group badge when chokeGroup > 0', () => {
        const pads = [makePad(0, { chokeGroup: 2 })];
        render(<PadGrid pads={pads} selectedIndex={0} onSelectPad={vi.fn()} onTriggerPad={vi.fn()} />);
        expect(screen.getByText('C2')).toBeTruthy();
    });

    it('shows volume percentage readout', () => {
        const pads = [makePad(0, { volume: 0.65 })];
        render(<PadGrid pads={pads} selectedIndex={0} onSelectPad={vi.fn()} onTriggerPad={vi.fn()} />);
        expect(screen.getByText('65%')).toBeTruthy();
    });
});
