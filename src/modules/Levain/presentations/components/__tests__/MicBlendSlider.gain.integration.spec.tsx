import { useState } from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDefaultPatch } from '../../../models/LevainPatch';
import { MicBlendSlider } from '../MicBlendSlider';

describe('microphone fader gain', () => {
    afterEach(() => vi.restoreAllMocks());

    it('reports and sends the real linear gain at pointer positions', () => {
        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
            x: 0,
            y: 0,
            width: 40,
            height: 100,
            top: 0,
            left: 0,
            right: 40,
            bottom: 100,
            toJSON: () => ({}),
        });
        const onSend = vi.fn();
        const onUpdate = vi.fn();
        function Harness() {
            const [mics, setMics] = useState(() => [{ ...createDefaultPatch().micPositions[0]!, volume: 0.5 }]);
            return (
                <MicBlendSlider
                    micPositions={mics}
                    showFull
                    onSendMicParam={onSend}
                    onUpdateMicPosition={(index, update) => {
                        onUpdate(index, update);
                        setMics((current) => current.map((mic, i) => (i === index ? { ...mic, ...update } : mic)));
                    }}
                />
            );
        }
        render(<Harness />);
        const slider = screen.getByRole('slider', { name: /close level/i });
        expect(slider).toHaveAttribute('aria-valuetext', '-6.0 dB');
        const track = slider.querySelector('[data-role="fader-track"]')!;
        fireEvent.pointerDown(track, { button: 0, pointerId: 1, clientY: 30 });
        fireEvent.pointerUp(slider, { pointerId: 1 });
        expect(onUpdate).toHaveBeenLastCalledWith(0, { volume: expect.closeTo(0.7, 9) });
        expect(onSend).toHaveBeenLastCalledWith(0, 'volume', expect.closeTo(0.7, 9));
        expect(slider).toHaveAttribute('aria-valuetext', '-3.1 dB');
        fireEvent.keyDown(slider, { key: 'End' });
        expect(onSend).toHaveBeenLastCalledWith(0, 'volume', 1);
        expect(slider).toHaveAttribute('aria-valuetext', '0.0 dB');
        fireEvent.keyDown(slider, { key: 'Home' });
        expect(onSend).toHaveBeenLastCalledWith(0, 'volume', 0);
        expect(slider).toHaveAttribute('aria-valuetext', '-∞ dB');
    });

    it('shows a saved 0.7 gain at 70% travel with its true level', () => {
        const mic = { ...createDefaultPatch().micPositions[0]!, volume: 0.7, enabled: true };
        render(<MicBlendSlider micPositions={[mic]} showFull onSendMicParam={vi.fn()} onUpdateMicPosition={vi.fn()} />);
        const slider = screen.getByRole('slider', { name: /close level/i });
        expect(slider).toHaveAttribute('aria-valuenow', '0.7');
        expect(slider).toHaveAttribute('aria-valuetext', '-3.1 dB');
        expect((slider.querySelector('[data-role="fader-cap"]') as HTMLElement).style.bottom).toBe('calc(70% - 20px)');
        expect((slider.querySelector('[data-role="fader-unity"]') as HTMLElement).style.bottom).toBe('100%');
    });

    it('preserves reset and keyboard gain increments and the disabled stored value', () => {
        const onSend = vi.fn();
        const onUpdate = vi.fn();
        const mic = { ...createDefaultPatch().micPositions[0]!, volume: 0.5, enabled: true };
        const { rerender } = render(
            <MicBlendSlider micPositions={[mic]} showFull onSendMicParam={onSend} onUpdateMicPosition={onUpdate} />
        );
        const slider = screen.getByRole('slider', { name: /close level/i });
        fireEvent.keyDown(slider, { key: 'ArrowUp' });
        expect(onSend.mock.lastCall?.[2]).toBeCloseTo(0.5 + 0.5 / 76, 9);
        fireEvent.keyDown(slider, { key: 'ArrowUp', shiftKey: true });
        expect(onSend.mock.lastCall?.[2]).toBeCloseTo(0.5 + 0.1 / 76, 9);
        fireEvent.keyDown(slider, { key: 'PageUp' });
        expect(onSend.mock.lastCall?.[2]).toBeCloseTo(45 / 76, 9);
        fireEvent.doubleClick(slider);
        expect(onSend.mock.lastCall?.[2]).toBeCloseTo(64 / 76, 9);
        expect(onUpdate.mock.lastCall?.[1].volume).toBeCloseTo(64 / 76, 9);
        onSend.mockClear();
        onUpdate.mockClear();
        rerender(
            <MicBlendSlider
                micPositions={[{ ...mic, enabled: false }]}
                showFull
                onSendMicParam={onSend}
                onUpdateMicPosition={onUpdate}
            />
        );
        expect(slider).toHaveAttribute('aria-valuenow', '0');
        expect(onSend).not.toHaveBeenCalled();
        expect(onUpdate).not.toHaveBeenCalled();
        rerender(
            <MicBlendSlider micPositions={[mic]} showFull onSendMicParam={onSend} onUpdateMicPosition={onUpdate} />
        );
        expect(slider).toHaveAttribute('aria-valuenow', '0.5');
    });
});
