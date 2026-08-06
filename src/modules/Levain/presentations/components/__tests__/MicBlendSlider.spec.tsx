import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { createDefaultPatch, type MicPositionState } from '../../../models/LevainPatch';
import { MicBlendSlider } from '../MicBlendSlider';

vi.mock('#/components/daw/RotaryKnob', () => ({
    RotaryKnob: ({ value, onChange }: { value: number; onChange: (v: number) => void }) => (
        <input type="range" data-testid="blend-knob" value={value} onChange={(e) => onChange(Number(e.target.value))} />
    ),
}));

vi.mock('#/components/daw/DawPluginSectionHeader', () => ({
    DawPluginSectionHeader: () => <div />,
}));
vi.mock('#/components/daw/DawPluginToggle', () => ({
    DawPluginToggle: ({
        children,
        onClick,
        pressed,
    }: {
        children: React.ReactNode;
        onClick: () => void;
        pressed?: boolean;
    }) => (
        <button type="button" data-testid="mic-toggle" data-pressed={pressed} onClick={onClick}>
            {children}
        </button>
    ),
}));
vi.mock('#/components/daw/Fader', () => ({
    Fader: ({ value, onChange }: { value: number; onChange: (v: number) => void }) => (
        <input type="range" data-testid="fader" value={value} onChange={(e) => onChange(Number(e.target.value))} />
    ),
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
        expect(screen.getByText(/close/i)).toBeTruthy();
    });

    it('sits at the neutral midpoint when both mics are silent', () => {
        render(<MicBlendSlider micPositions={mics(0, 0)} onSendMicParam={vi.fn()} onUpdateMicPosition={vi.fn()} />);
        expect(screen.getByTestId('blend-knob')).toHaveValue('0.5');
    });

    it('round-trips: a knob value reads back as the same blend', () => {
        const onUpdate = vi.fn();
        const onSend = vi.fn();
        const { rerender } = render(
            <MicBlendSlider micPositions={mics(0.8, 0.3)} onSendMicParam={onSend} onUpdateMicPosition={onUpdate} />
        );
        fireEvent.change(screen.getByTestId('blend-knob'), { target: { value: '0.6' } });
        expect(onUpdate).toHaveBeenCalledWith(0, { volume: 0.4 });
        expect(onUpdate).toHaveBeenCalledWith(2, expect.objectContaining({ volume: 0.6 }));
        rerender(
            <MicBlendSlider micPositions={mics(0.4, 0.6)} onSendMicParam={onSend} onUpdateMicPosition={onUpdate} />
        );
        expect(screen.getByTestId('blend-knob')).toHaveValue('0.6');
    });
});

describe('MicBlendSlider — compact blend room enable threshold', () => {
    it('disables room mic when blend is below 0.05', () => {
        const onUpdate = vi.fn();
        const onSend = vi.fn();
        render(<MicBlendSlider micPositions={mics(0.8, 0.3)} onSendMicParam={onSend} onUpdateMicPosition={onUpdate} />);
        fireEvent.change(screen.getByTestId('blend-knob'), { target: { value: '0.03' } });
        // Room at 0.03 is below 0.05 threshold → enabled: false
        expect(onUpdate).toHaveBeenCalledWith(2, expect.objectContaining({ enabled: false }));
        expect(onSend).toHaveBeenCalledWith(2, 'enabled', 0.0);
    });

    it('enables room mic when blend is above 0.05', () => {
        const onSend = vi.fn();
        render(<MicBlendSlider micPositions={mics(0.8, 0.3)} onSendMicParam={onSend} onUpdateMicPosition={vi.fn()} />);
        fireEvent.change(screen.getByTestId('blend-knob'), { target: { value: '0.1' } });
        expect(onSend).toHaveBeenCalledWith(2, 'enabled', 1.0);
    });
});

describe('MicBlendSlider — full mixer mode', () => {
    it('toggles mic enable and sends param', () => {
        const onUpdate = vi.fn();
        const onSend = vi.fn();
        const patch = createDefaultPatch('violin-1');
        render(
            <MicBlendSlider
                micPositions={patch.micPositions}
                showFull
                onSendMicParam={onSend}
                onUpdateMicPosition={onUpdate}
            />
        );
        const toggles = screen.getAllByTestId('mic-toggle');
        fireEvent.click(toggles[0]!);
        // First mic starts enabled, so toggle disables
        expect(onUpdate).toHaveBeenCalledWith(0, { enabled: false });
        expect(onSend).toHaveBeenCalledWith(0, 'enabled', 0.0);
    });

    it('shows ON label when mic is enabled', () => {
        const patch = createDefaultPatch('violin-1');
        render(
            <MicBlendSlider
                micPositions={patch.micPositions}
                showFull
                onSendMicParam={vi.fn()}
                onUpdateMicPosition={vi.fn()}
            />
        );
        const toggles = screen.getAllByTestId('mic-toggle');
        expect(toggles[0]?.textContent).toContain('ON');
    });

    it('transforms fader dB to volume fraction on change', () => {
        const onUpdate = vi.fn();
        const onSend = vi.fn();
        const patch = createDefaultPatch('violin-1');
        render(
            <MicBlendSlider
                micPositions={patch.micPositions}
                showFull
                onSendMicParam={onSend}
                onUpdateMicPosition={onUpdate}
            />
        );
        // Fader sends dB value; component transforms (db + 70) / 76 → 0-1
        fireEvent.change(screen.getAllByTestId('fader')[0]!, { target: { value: '6' } });
        // (6 + 70) / 76 = 1.0
        expect(onUpdate).toHaveBeenCalledWith(0, { volume: 1 });
        expect(onSend).toHaveBeenCalledWith(0, 'volume', 1);
    });
});
