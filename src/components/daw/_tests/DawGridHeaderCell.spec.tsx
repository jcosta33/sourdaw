import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DawGridHeaderCell } from '../DawGridHeaderCell';

describe('DawGridHeaderCell', () => {
    it('should apply accent border color when accentColor is set', () => {
        render(<DawGridHeaderCell accentColor="#f00">A1</DawGridHeaderCell>);
        const cell = screen.getByText('A1');
        expect(cell).toHaveStyle({ borderTopColor: '#f00' });
    });
});
