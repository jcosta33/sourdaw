import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { type PadState } from '../../../models/ToasterKit';
import { PadMixer } from '../PadMixer';

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

describe('PadMixer', () => {
    it('should render', () => {
        const pads = Array.from({ length: 4 }, (_, index) => makePad(index));
        render(<PadMixer pads={pads} onPadParam={vi.fn()} />);
        expect(screen.getByText('P0')).toBeInTheDocument();
    });

    it('should expose each volume fader as a focusable slider with aria value state', () => {
        const pad = makePad(0);
        pad.volume = 0.6;
        render(<PadMixer pads={[pad]} onPadParam={vi.fn()} />);

        const slider = screen.getByRole('slider', { name: /p0 volume/i });
        expect(slider).toHaveAttribute('aria-valuemin', '0');
        expect(slider).toHaveAttribute('aria-valuemax', '100');
        expect(slider).toHaveAttribute('aria-valuenow', '60');
        expect(slider).toHaveAttribute('aria-orientation', 'vertical');
        expect(slider).toHaveAttribute('tabindex', '0');
    });

    it('should raise and lower volume from the keyboard on the fader slider', () => {
        const onPadParam = vi.fn();
        const pad = makePad(0);
        pad.volume = 0.5;
        render(<PadMixer pads={[pad]} onPadParam={onPadParam} />);

        const slider = screen.getByRole('slider', { name: /p0 volume/i });
        fireEvent.keyDown(slider, { key: 'ArrowUp' });
        expect(onPadParam).toHaveBeenCalledWith(0, 'volume', expect.closeTo(0.55, 5));

        onPadParam.mockClear();
        fireEvent.keyDown(slider, { key: 'ArrowDown' });
        expect(onPadParam).toHaveBeenCalledWith(0, 'volume', expect.closeTo(0.45, 5));

        onPadParam.mockClear();
        fireEvent.keyDown(slider, { key: 'Home' });
        expect(onPadParam).toHaveBeenCalledWith(0, 'volume', 0);

        onPadParam.mockClear();
        fireEvent.keyDown(slider, { key: 'End' });
        expect(onPadParam).toHaveBeenCalledWith(0, 'volume', 1);
    });

    it('should release a fader drag on pointercancel so no listener leaks past a missed pointerup', () => {
        const onPadParam = vi.fn();
        const pad = makePad(0);
        render(<PadMixer pads={[pad]} onPadParam={onPadParam} />);

        const slider = screen.getByRole('slider', { name: /p0 volume/i });
        fireEvent.pointerDown(slider, { clientY: 10 });
        // A move while dragging updates volume.
        fireEvent.pointerMove(document, { clientY: 20 });
        const callsWhileDragging = onPadParam.mock.calls.length;
        expect(callsWhileDragging).toBeGreaterThan(0);

        // A cancel (instead of pointerup) must detach the move listener.
        fireEvent.pointerCancel(document);
        onPadParam.mockClear();
        fireEvent.pointerMove(document, { clientY: 40 });
        expect(onPadParam).not.toHaveBeenCalled();
    });

    /**
     * The solo button shipped `disabled` while the engine had no `soloed` arm.
     * Asserting both directions is what keeps it honest: a handler that always
     * sent 1 would pass a single click, and the engine gates every pad that is
     * not soloed, so a solo that cannot be released silences the device.
     */
    it('should toggle solo on and off through the pad param callback', () => {
        const onPadParam = vi.fn();
        const pad = makePad(0);
        const { rerender } = render(<PadMixer pads={[pad]} onPadParam={onPadParam} />);

        fireEvent.click(screen.getByRole('button', { name: 'S' }));
        expect(onPadParam).toHaveBeenCalledWith(0, 'soloed', 1);

        onPadParam.mockClear();
        rerender(<PadMixer pads={[{ ...pad, soloed: true }]} onPadParam={onPadParam} />);
        fireEvent.click(screen.getByRole('button', { name: 'S' }));
        expect(onPadParam).toHaveBeenCalledWith(0, 'soloed', 0);
    });

    it('should address solo to the pad that was clicked', () => {
        const onPadParam = vi.fn();
        const pads = Array.from({ length: 4 }, (_, index) => makePad(index));
        render(<PadMixer pads={pads} onPadParam={onPadParam} />);

        const soloButtons = screen.getAllByRole('button', { name: 'S' });
        fireEvent.click(soloButtons[2]!);

        expect(onPadParam).toHaveBeenCalledWith(2, 'soloed', 1);
        expect(onPadParam).toHaveBeenCalledTimes(1);
    });

    it('should release a fader drag on window blur', () => {
        const onPadParam = vi.fn();
        const pad = makePad(0);
        render(<PadMixer pads={[pad]} onPadParam={onPadParam} />);

        const slider = screen.getByRole('slider', { name: /p0 volume/i });
        fireEvent.pointerDown(slider, { clientY: 10 });
        fireEvent.blur(window);
        onPadParam.mockClear();
        fireEvent.pointerMove(document, { clientY: 40 });
        expect(onPadParam).not.toHaveBeenCalled();
    });
});
