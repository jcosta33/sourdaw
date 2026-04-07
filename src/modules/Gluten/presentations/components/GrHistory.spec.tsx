import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { GrHistory } from './GrHistory';

describe('GrHistory', () => {
    it('should render', () => {
        const { container } = render(<GrHistory grDb={-3} width={200} height={40} />);
        expect(container.querySelector('canvas')).toBeTruthy();
    });
});
