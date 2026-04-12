import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ADSREnvelope } from '../ADSREnvelope';

describe('ADSREnvelope', () => {
    it('should render canvas', () => {
        const { container } = render(<ADSREnvelope attack={0.1} decay={0.2} sustain={0.5} release={0.3} />);
        expect(container.querySelector('canvas')).toBeInTheDocument();
    });
});
