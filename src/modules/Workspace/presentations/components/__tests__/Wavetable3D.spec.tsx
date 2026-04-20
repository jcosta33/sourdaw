import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { Wavetable3D } from '../Wavetable3D';

describe('Wavetable3D', () => {
    it('should mount a canvas', () => {
        const { container } = render(<Wavetable3D width={120} height={90} />);
        expect(container.querySelector('canvas')).toBeInTheDocument();
    });
});
