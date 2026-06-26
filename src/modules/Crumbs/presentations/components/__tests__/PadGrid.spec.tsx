import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { type PadConfig } from '../../../models/CrumbsTypes';
import { PadGrid } from '../PadGrid';

function makePad(index: number): PadConfig {
    return {
        id: index,
        name: `P${index}`,
        color: '#333',
        sampleId: null,
        midiNote: 36 + index,
        chokeGroup: 0,
        volume: 1,
        pan: 0,
        tune: 0,
        attack: 0,
        decay: 0,
        sustain: 1,
        release: 0,
        filterCutoff: 20000,
        filterResonance: 0,
        loopMode: 'off',
        reverse: false,
        oneShot: true,
    };
}

describe('PadGrid', () => {
    it('should render', () => {
        const pads = Array.from({ length: 16 }, (_, i) => makePad(i));
        render(<PadGrid pads={pads} selectedIndex={0} onSelectPad={vi.fn()} onTriggerPad={vi.fn()} />);
        expect(screen.getByText('P0')).toBeInTheDocument();
    });

    it('releases the note on mouse up after a mouse-down trigger', () => {
        const pads = Array.from({ length: 16 }, (_, i) => makePad(i));
        const onTriggerPad = vi.fn();
        const onTriggerPadOff = vi.fn();
        render(
            <PadGrid
                pads={pads}
                selectedIndex={0}
                onSelectPad={vi.fn()}
                onTriggerPad={onTriggerPad}
                onTriggerPadOff={onTriggerPadOff}
            />
        );

        const pad = screen.getByText('P3').closest('button');
        expect(pad).not.toBeNull();

        fireEvent.mouseDown(pad!);
        expect(onTriggerPad).toHaveBeenCalledWith(3);
        expect(onTriggerPadOff).not.toHaveBeenCalled();

        fireEvent.mouseUp(pad!);
        expect(onTriggerPadOff).toHaveBeenCalledWith(3);
    });

    it('releases the note only once when mouse up is followed by mouse leave', () => {
        const pads = Array.from({ length: 16 }, (_, i) => makePad(i));
        const onTriggerPadOff = vi.fn();
        render(
            <PadGrid
                pads={pads}
                selectedIndex={0}
                onSelectPad={vi.fn()}
                onTriggerPad={vi.fn()}
                onTriggerPadOff={onTriggerPadOff}
            />
        );

        const pad = screen.getByText('P0').closest('button')!;
        fireEvent.mouseDown(pad);
        fireEvent.mouseUp(pad);
        fireEvent.mouseLeave(pad);

        expect(onTriggerPadOff).toHaveBeenCalledTimes(1);
    });

    it('releases the note on key up after a keyboard trigger', () => {
        const pads = Array.from({ length: 16 }, (_, i) => makePad(i));
        const onTriggerPad = vi.fn();
        const onTriggerPadOff = vi.fn();
        render(
            <PadGrid
                pads={pads}
                selectedIndex={0}
                onSelectPad={vi.fn()}
                onTriggerPad={onTriggerPad}
                onTriggerPadOff={onTriggerPadOff}
            />
        );

        const pad = screen.getByText('P5').closest('button')!;
        fireEvent.keyDown(pad, { key: 'Enter' });
        expect(onTriggerPad).toHaveBeenCalledWith(5);
        expect(onTriggerPadOff).not.toHaveBeenCalled();

        fireEvent.keyUp(pad, { key: 'Enter' });
        expect(onTriggerPadOff).toHaveBeenCalledWith(5);
    });

    it('does not release a pad that was never triggered', () => {
        const pads = Array.from({ length: 16 }, (_, i) => makePad(i));
        const onTriggerPadOff = vi.fn();
        render(
            <PadGrid
                pads={pads}
                selectedIndex={0}
                onSelectPad={vi.fn()}
                onTriggerPad={vi.fn()}
                onTriggerPadOff={onTriggerPadOff}
            />
        );

        const pad = screen.getByText('P2').closest('button')!;
        // A stray mouse leave with no preceding mouse down must not emit a note-off.
        fireEvent.mouseLeave(pad);
        expect(onTriggerPadOff).not.toHaveBeenCalled();
    });
});
