import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RotaryKnob } from './RotaryKnob';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((_, initial: unknown) => initial),
}));
vi.mock('#/modules/MIDI/useCases/midiLearn', () => ({
    startMidiLearn: vi.fn(),
}));

describe('RotaryKnob', () => {
    it('should render label', () => {
        render(<RotaryKnob value={50} onChange={vi.fn()} label="Gain" />);
        expect(screen.getByText('Gain')).toBeInTheDocument();
    });

    it('should reset to default on double click', () => {
        const onChange = vi.fn();
        const { container } = render(
            <RotaryKnob value={10} onChange={onChange} defaultValue={50} min={0} max={100} />
        );
        fireEvent.doubleClick(container.firstChild as HTMLElement);
        expect(onChange).toHaveBeenCalledWith(50);
    });
});
