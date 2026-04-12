import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ReverbDecay } from '../ReverbDecay';

describe('ReverbDecay', () => {
    it('should render canvas', () => {
        const { container } = render(<ReverbDecay size={0.5} decay={1.2} damping={0.3} predelay={20} />);
        expect(container.querySelector('canvas')).toBeInTheDocument();
    });
});
