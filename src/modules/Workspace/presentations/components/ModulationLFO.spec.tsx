import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ModulationLFO } from './ModulationLFO';

describe('ModulationLFO', () => {
    it('should mount a canvas for waveform preview', () => {
        const { container } = render(<ModulationLFO rate={2} depth={0.5} shape="sine" width={100} height={40} />);
        const canvas = container.querySelector('canvas');
        expect(canvas).toBeInTheDocument();
    });
});
