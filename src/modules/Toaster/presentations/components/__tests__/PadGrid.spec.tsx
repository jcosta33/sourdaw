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

    it('fires onSelectPad and onTriggerPad during full mouse cycle in normal mode', () => {
        const onSelectPad = vi.fn();
        const onTriggerPad = vi.fn();
        const pads = Array.from({ length: 4 }, (_, index) => makePad(index));
        render(<PadGrid pads={pads} selectedIndex={0} onSelectPad={onSelectPad} onTriggerPad={onTriggerPad} />);
        const pad2 = screen.getByRole('button', { name: /trigger p2/i });
        fireEvent.mouseDown(pad2, { button: 0 });
        fireEvent.mouseUp(pad2);
        fireEvent.click(pad2);
        expect(onTriggerPad).toHaveBeenCalledWith(2);
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

describe('PadGrid — 16 Levels mode', () => {
    it('renders 16-levels display text, secondary pad name, and aria-labels for velocity', () => {
        const pads = Array.from({ length: 16 }, (_, index) => makePad(index));
        render(
            <PadGrid
                pads={pads}
                selectedIndex={0}
                onSelectPad={vi.fn()}
                onTriggerPad={vi.fn()}
                sixteenLevelsTarget="velocity"
                targetPadName="Custom Kick"
            />
        );

        // Level 1: round((1/16)*127) = 8
        expect(screen.getByText('Vel 8')).toBeTruthy();
        // Level 16: round((16/16)*127) = 127
        expect(screen.getByText('Vel 127')).toBeTruthy();
        // All pads show the targetPadName as secondary
        expect(screen.getAllByText('Custom Kick').length).toBe(16);

        // aria-labels
        expect(screen.getByRole('button', { name: 'Trigger level 1 (Vel 8) of Custom Kick' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Trigger level 16 (Vel 127) of Custom Kick' })).toBeTruthy();
    });

    it.each([
        { target: 'tune' as const, level0: '-21.0st', level15: '24.0st' },
        { target: 'decay' as const, level0: '6%', level15: '100%' },
        { target: 'filter' as const, level0: '31Hz', level15: '20000Hz' },
    ])('renders correct level readouts for $target target', ({ target, level0, level15 }) => {
        const pads = Array.from({ length: 16 }, (_, index) => makePad(index));
        render(
            <PadGrid
                pads={pads}
                selectedIndex={0}
                onSelectPad={vi.fn()}
                onTriggerPad={vi.fn()}
                sixteenLevelsTarget={target}
            />
        );

        expect(screen.getByText(level0)).toBeTruthy();
        expect(screen.getByText(level15)).toBeTruthy();
    });

    it('triggers exactly once on a pure synthetic click in 16-levels mode', () => {
        const onSelectPad = vi.fn();
        const onTriggerPad = vi.fn();
        const pads = Array.from({ length: 16 }, (_, index) => makePad(index));
        render(
            <PadGrid
                pads={pads}
                selectedIndex={0}
                onSelectPad={onSelectPad}
                onTriggerPad={onTriggerPad}
                sixteenLevelsTarget="tune"
            />
        );

        const pad2 = screen.getByRole('button', { name: /trigger level 3/i });
        fireEvent.click(pad2);

        expect(onSelectPad).not.toHaveBeenCalled();
        expect(onTriggerPad).toHaveBeenCalledTimes(1);
        expect(onTriggerPad).toHaveBeenCalledWith(2);
    });

    it('triggers exactly once during a full mouse click cycle in 16-levels mode', () => {
        const onTriggerPad = vi.fn();
        const onReleasePad = vi.fn();
        const pads = Array.from({ length: 4 }, (_, index) => makePad(index));
        render(
            <PadGrid
                pads={pads}
                selectedIndex={0}
                onSelectPad={vi.fn()}
                onTriggerPad={onTriggerPad}
                onReleasePad={onReleasePad}
                sixteenLevelsTarget="tune"
            />
        );

        const pad1 = screen.getByRole('button', { name: /trigger level 2/i });
        fireEvent.mouseDown(pad1, { button: 0 });
        fireEvent.mouseUp(pad1);
        fireEvent.click(pad1);

        expect(onTriggerPad).toHaveBeenCalledTimes(1);
        expect(onTriggerPad).toHaveBeenCalledWith(1);
        expect(onReleasePad).toHaveBeenCalledTimes(1);
        expect(onReleasePad).toHaveBeenCalledWith(1);
    });

    it('triggers exactly once during a Space key cycle in 16-levels mode', () => {
        const onTriggerPad = vi.fn();
        const onReleasePad = vi.fn();
        const pads = Array.from({ length: 4 }, (_, index) => makePad(index));
        render(
            <PadGrid
                pads={pads}
                selectedIndex={0}
                onSelectPad={vi.fn()}
                onTriggerPad={onTriggerPad}
                onReleasePad={onReleasePad}
                sixteenLevelsTarget="tune"
            />
        );

        const pad2 = screen.getByRole('button', { name: /trigger level 3/i });
        fireEvent.keyDown(pad2, { key: ' ' });
        fireEvent.keyUp(pad2, { key: ' ' });
        fireEvent.click(pad2);

        expect(onTriggerPad).toHaveBeenCalledTimes(1);
        expect(onTriggerPad).toHaveBeenCalledWith(2);
        expect(onReleasePad).toHaveBeenCalledTimes(1);
        expect(onReleasePad).toHaveBeenCalledWith(2);
    });

    it('omits aria-pressed in 16-levels mode', () => {
        const pads = Array.from({ length: 4 }, (_, index) => makePad(index));
        render(
            <PadGrid
                pads={pads}
                selectedIndex={0}
                onSelectPad={vi.fn()}
                onTriggerPad={vi.fn()}
                sixteenLevelsTarget="tune"
            />
        );

        const pad0 = screen.getByRole('button', { name: /trigger level 1/i });
        expect(pad0).not.toHaveAttribute('aria-pressed');
    });

    it('suppresses choke group badges and mute overlays in 16-levels mode', () => {
        const pads = [
            makePad(0, { chokeGroup: 2, muted: true, color: '#112233' }),
            makePad(1, { chokeGroup: 1, muted: true, color: '#445566' }),
        ];
        render(
            <PadGrid
                pads={pads}
                selectedIndex={0}
                onSelectPad={vi.fn()}
                onTriggerPad={vi.fn()}
                sixteenLevelsTarget="decay"
            />
        );

        expect(screen.queryByText('Mute')).toBeNull();
        expect(screen.queryByText('C2')).toBeNull();
        expect(screen.queryByText('C1')).toBeNull();
        expect(screen.getByText('6%')).toBeTruthy();
    });
});

describe('PadGrid — release events', () => {
    it('fires onReleasePad on mouseUp when pressed', () => {
        const onReleasePad = vi.fn();
        const pads = Array.from({ length: 4 }, (_, index) => makePad(index));
        render(
            <PadGrid
                pads={pads}
                selectedIndex={0}
                onSelectPad={vi.fn()}
                onTriggerPad={vi.fn()}
                onReleasePad={onReleasePad}
            />
        );

        const pad = screen.getByRole('button', { name: /trigger p1/i });
        fireEvent.mouseDown(pad, { button: 0 });
        fireEvent.mouseUp(pad);

        expect(onReleasePad).toHaveBeenCalledWith(1);
    });

    it('fires onReleasePad on mouseLeave when pressed, but not when unpressed', () => {
        const onReleasePad = vi.fn();
        const pads = Array.from({ length: 4 }, (_, index) => makePad(index));
        render(
            <PadGrid
                pads={pads}
                selectedIndex={0}
                onSelectPad={vi.fn()}
                onTriggerPad={vi.fn()}
                onReleasePad={onReleasePad}
            />
        );

        const pad = screen.getByRole('button', { name: /trigger p2/i });
        fireEvent.mouseLeave(pad);
        expect(onReleasePad).not.toHaveBeenCalled();

        fireEvent.mouseDown(pad, { button: 0 });
        fireEvent.mouseLeave(pad);
        expect(onReleasePad).toHaveBeenCalledWith(2);
    });

    it('fires onReleasePad on keyUp for Enter and Space', () => {
        const onReleasePad = vi.fn();
        const pads = Array.from({ length: 4 }, (_, index) => makePad(index));
        render(
            <PadGrid
                pads={pads}
                selectedIndex={0}
                onSelectPad={vi.fn()}
                onTriggerPad={vi.fn()}
                onReleasePad={onReleasePad}
            />
        );

        const pad = screen.getByRole('button', { name: /trigger p3/i });
        fireEvent.keyUp(pad, { key: 'Enter' });
        expect(onReleasePad).toHaveBeenCalledWith(3);

        onReleasePad.mockClear();
        fireEvent.keyUp(pad, { key: ' ' });
        expect(onReleasePad).toHaveBeenCalledWith(3);

        onReleasePad.mockClear();
        fireEvent.keyUp(pad, { key: 'Tab' });
        expect(onReleasePad).not.toHaveBeenCalled();
    });
});
