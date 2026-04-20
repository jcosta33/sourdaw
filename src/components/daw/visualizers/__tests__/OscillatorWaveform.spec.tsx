import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { OscillatorWaveform } from '../OscillatorWaveform';

describe('OscillatorWaveform', () => {
    it('should render canvas', () => {
        const { container } = render(<OscillatorWaveform waveform="sine" />);
        expect(container.querySelector('canvas')).toBeInTheDocument();
    });
});
