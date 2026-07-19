import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { CrustGainStrip } from '../CrustGainStrip';

describe('CrustGainStrip readout and slider attributes', () => {
    it('formats a positive value with a leading plus sign, rounded to one decimal', () => {
        const { container } = render(<CrustGainStrip value={6} onChange={vi.fn()} />);

        expect(container.querySelector('span[aria-hidden="true"]')).toHaveTextContent('+6.0');
    });

    it('formats zero without a leading plus sign', () => {
        const { container } = render(<CrustGainStrip value={0} onChange={vi.fn()} />);

        expect(container.querySelector('span[aria-hidden="true"]')).toHaveTextContent('0.0');
    });

    it('exposes the raw value and a dB-suffixed text alternative on the slider role', () => {
        render(<CrustGainStrip value={9.25} onChange={vi.fn()} />);

        const slider = screen.getByRole('slider', { name: 'Input gain' });
        expect(slider).toHaveAttribute('aria-valuemin', '0');
        expect(slider).toHaveAttribute('aria-valuemax', '18');
        expect(slider).toHaveAttribute('aria-valuenow', '9.3');
        expect(slider).toHaveAttribute('aria-valuetext', '9.3 dB');
    });

    it('colours the readout amber above 6 dB and red above 12 dB, default at and below 6 dB', () => {
        const atSix = render(<CrustGainStrip value={6} onChange={vi.fn()} />);
        expect(atSix.container.querySelector('span[aria-hidden="true"]')).toHaveStyle({ color: '#E8E6E0' });
        atSix.unmount();

        const aboveSix = render(<CrustGainStrip value={6.1} onChange={vi.fn()} />);
        expect(aboveSix.container.querySelector('span[aria-hidden="true"]')).toHaveStyle({ color: '#D4A847' });
        aboveSix.unmount();

        const atTwelve = render(<CrustGainStrip value={12} onChange={vi.fn()} />);
        expect(atTwelve.container.querySelector('span[aria-hidden="true"]')).toHaveStyle({ color: '#D4A847' });
        atTwelve.unmount();

        const aboveTwelve = render(<CrustGainStrip value={12.1} onChange={vi.fn()} />);
        expect(aboveTwelve.container.querySelector('span[aria-hidden="true"]')).toHaveStyle({ color: '#C44030' });
    });
});

describe('CrustGainStrip keyboard interaction', () => {
    it('increases the value by 0.1 dB on ArrowUp and clamps to the 18 dB ceiling', () => {
        const onChange = vi.fn();
        render(<CrustGainStrip value={17.95} onChange={onChange} />);

        const event = fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowUp' });

        expect(onChange).toHaveBeenCalledWith(18);
        // ArrowUp is a value-changing key; the default browser scroll behaviour must be suppressed.
        expect(event).toBe(false);
    });

    it('increases the value by a full 1 dB step on Shift+ArrowUp', () => {
        const onChange = vi.fn();
        render(<CrustGainStrip value={4} onChange={onChange} />);

        fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowUp', shiftKey: true });

        expect(onChange).toHaveBeenCalledWith(5);
    });

    it('decreases the value by 0.1 dB on ArrowDown and clamps to the 0 dB floor', () => {
        const onChange = vi.fn();
        render(<CrustGainStrip value={0.05} onChange={onChange} />);

        fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowDown' });

        expect(onChange).toHaveBeenCalledWith(0);
    });

    it('decreases the value by a full 1 dB step on Shift+ArrowDown', () => {
        const onChange = vi.fn();
        render(<CrustGainStrip value={4} onChange={onChange} />);

        fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowDown', shiftKey: true });

        expect(onChange).toHaveBeenCalledWith(3);
    });

    it('ignores keys other than the arrow keys', () => {
        const onChange = vi.fn();
        render(<CrustGainStrip value={4} onChange={onChange} />);

        fireEvent.keyDown(screen.getByRole('slider'), { key: 'Enter' });

        expect(onChange).not.toHaveBeenCalled();
    });
});

describe('CrustGainStrip pointer drag', () => {
    it('does not call onChange from pointer down alone', () => {
        const onChange = vi.fn();
        render(<CrustGainStrip value={6} onChange={onChange} />);

        fireEvent.pointerDown(screen.getByRole('slider'), { pointerId: 1, clientY: 100 });

        expect(onChange).not.toHaveBeenCalled();
    });

    it('maps an upward drag to an increased value, scaled by the track height', () => {
        const onChange = vi.fn();
        render(<CrustGainStrip value={6} onChange={onChange} />);
        const slider = screen.getByRole('slider');
        vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue(
            new DOMRect(0, 0, 20, 100) // 100px track height
        );

        // Drag starts at clientY 100 and moves up to clientY 50: dy = +50 (upward = more gain).
        // delta = (50 / 100) * 18 * 1 = 9 → clamp(6 + 9) = 15.
        fireEvent.pointerDown(slider, { pointerId: 1, clientY: 100 });
        fireEvent.pointerMove(slider, { pointerId: 1, clientY: 50 });

        expect(onChange).toHaveBeenCalledWith(15);
    });

    it('scales the drag delta by 0.1x in fine mode (ctrl/cmd held)', () => {
        const onChange = vi.fn();
        render(<CrustGainStrip value={6} onChange={onChange} />);
        const slider = screen.getByRole('slider');
        vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 20, 100));

        // Same drag as above, but with ctrlKey held: delta = (50 / 100) * 18 * 0.1 = 0.9.
        fireEvent.pointerDown(slider, { pointerId: 1, clientY: 100 });
        fireEvent.pointerMove(slider, { pointerId: 1, clientY: 50, ctrlKey: true });

        expect(onChange).toHaveBeenCalledWith(6.9);
    });

    it('clamps a large downward drag to the 0 dB floor', () => {
        const onChange = vi.fn();
        render(<CrustGainStrip value={6} onChange={onChange} />);
        const slider = screen.getByRole('slider');
        vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 20, 100));

        fireEvent.pointerDown(slider, { pointerId: 1, clientY: 0 });
        fireEvent.pointerMove(slider, { pointerId: 1, clientY: 1000 });

        expect(onChange).toHaveBeenCalledWith(0);
    });

    it('stops responding to pointer moves once the pointer is released', () => {
        const onChange = vi.fn();
        render(<CrustGainStrip value={6} onChange={onChange} />);
        const slider = screen.getByRole('slider');
        vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 20, 100));

        fireEvent.pointerDown(slider, { pointerId: 1, clientY: 100 });
        fireEvent.pointerUp(slider, { pointerId: 1 });
        onChange.mockClear();

        fireEvent.pointerMove(slider, { pointerId: 1, clientY: 0 });

        expect(onChange).not.toHaveBeenCalled();
    });
});
