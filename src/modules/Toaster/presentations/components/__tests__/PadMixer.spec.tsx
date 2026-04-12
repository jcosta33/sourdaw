import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PadMixer } from '../PadMixer';
import { type PadState } from '../../../models/ToasterKit';

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
        const pads = Array.from({ length: 4 }, (_, i) => makePad(i));
        render(<PadMixer pads={pads} onPadParam={vi.fn()} />);
        expect(screen.getByText('P0')).toBeInTheDocument();
    });
});
