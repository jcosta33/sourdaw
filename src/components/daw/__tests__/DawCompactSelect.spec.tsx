import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { DawCompactSelect } from '../DawCompactSelect';

describe('DawCompactSelect', () => {
    it('should render options', () => {
        render(
            <DawCompactSelect tone="inset" aria-label="Shape">
                <option value="a">A</option>
                <option value="b">B</option>
            </DawCompactSelect>
        );
        expect(screen.getByRole('combobox', { name: 'Shape' })).toHaveClass('bg-surface-inset');
    });
});
