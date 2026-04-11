import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { KeyboardSplit } from '../KeyboardSplit';

describe('KeyboardSplit', () => {
    it('should render', () => {
        const { container } = render(<KeyboardSplit width={400} height={40} splitPoint={60} />);
        expect(container.querySelector('div')).toBeTruthy();
    });
});
