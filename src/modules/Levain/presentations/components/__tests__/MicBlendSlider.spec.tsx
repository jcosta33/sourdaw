import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { createDefaultPatch, type MicPositionState } from '../../../models/LevainPatch';
import { MicBlendSlider } from '../MicBlendSlider';

// Expose the compact blend knob's value/onChange through a plain range input so
// the blend math is observable through the public component surface.
vi.mock('#/components/daw/RotaryKnob', () => ({
    RotaryKnob: ({ value, onChange }: { value: number; onChange: (v: number) => void }) => (
        <input type="range" data-testid="blend-knob" value={value} onChange={(e) => onChange(Number(e.target.value))} />
    ),
}));

vi.mock('#/components/daw/DawPluginSectionHeader', () => ({
    DawPluginSectionHeader: () => <div />,
}));
vi.mock('#/components/daw/DawPluginToggle', () => ({
    DawPluginToggle: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
}));
vi.mock('#/components/daw/Fader', () => ({
    Fader: () => <div data-testid="fader" />,
}));

function mics(close: number, room: number): MicPositionState[] {
    const base = createDefaultPatch('violin-1').micPositions;
    const next = base.map((m) => ({ ...m }));
    next[0] = { ...next[0]!, volume: close };
    next[2] = { ...next[2]!, volume: room };
    return next;
}

describe('MicBlendSlider', () => {
    it('should render', () => {
        const patch = createDefaultPatch('violin-1');
        render(
            <MicBlendSlider
                micPositions={patch.micPositions}
                showFull
                onSendMicParam={vi.fn()}
                onUpdateMicPosition={vi.fn()}
            />
        );
        expect(screen.getByText(/close/i)).toBeInTheDocument();
    });

    describe('fix 6 — compact blend zero-guard and round-trip', () => {
        it('sits at the neutral midpoint when both mics are silent', () => {
            render(<MicBlendSlider micPositions={mics(0, 0)} onSendMicParam={vi.fn()} onUpdateMicPosition={vi.fn()} />);
            // Old code: roomVol/(0+0+0.001) collapsed toward full-Room (~1).
            expect(screen.getByTestId('blend-knob')).toHaveValue('0.5');
        });

        it('round-trips: a knob value reads back as the same blend', () => {
            const onUpdate = vi.fn();
            const onSend = vi.fn();
            const { rerender } = render(
                <MicBlendSlider micPositions={mics(0.8, 0.3)} onSendMicParam={onSend} onUpdateMicPosition={onUpdate} />
            );

            fireEvent.change(screen.getByTestId('blend-knob'), { target: { value: '0.6' } });

            // close = 1 - v, room = v
            expect(onUpdate).toHaveBeenCalledWith(0, { volume: 0.4 });
            expect(onUpdate).toHaveBeenCalledWith(2, expect.objectContaining({ volume: 0.6 }));

            // Re-render with the volumes the change produced; blend reads back as v.
            rerender(
                <MicBlendSlider micPositions={mics(0.4, 0.6)} onSendMicParam={onSend} onUpdateMicPosition={onUpdate} />
            );
            expect(screen.getByTestId('blend-knob')).toHaveValue('0.6');
        });
    });
});
