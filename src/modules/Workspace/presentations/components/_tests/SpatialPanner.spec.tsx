import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SpatialPanner } from '../SpatialPanner';

describe('SpatialPanner', () => {
    it('should mount a canvas', () => {
        const { container } = render(<SpatialPanner size={80} />);
        expect(container.querySelector('canvas')).toBeInTheDocument();
    });
});
