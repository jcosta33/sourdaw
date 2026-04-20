import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { type PadConfig } from '../../../models/SamplerTypes';
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
});
