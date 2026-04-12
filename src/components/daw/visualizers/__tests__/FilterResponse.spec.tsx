import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { FilterResponse } from '../FilterResponse';

describe('FilterResponse', () => {
    it('should render canvas', () => {
        const { container } = render(<FilterResponse cutoff={1000} resonance={0.7} filterType={0} />);
        expect(container.querySelector('canvas')).toBeInTheDocument();
    });
});
