import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { DawCompactInput } from '../DawCompactInput';

describe('DawCompactInput', () => {
    it('should render input with size and align classes', () => {
        render(<DawCompactInput size="micro" align="center" monospace defaultValue="1" aria-label="v" />);
        const input = screen.getByRole('textbox', { name: 'v' });
        expect(input).toHaveClass('h-6');
        expect(input).toHaveClass('text-center');
        expect(input).toHaveClass('font-mono');
    });
});
