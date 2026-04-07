import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DawCompactCheckbox } from './DawCompactCheckbox';

describe('DawCompactCheckbox', () => {
    it('should render checkbox with default type', () => {
        render(<DawCompactCheckbox defaultChecked aria-label="Mute" />);
        expect(screen.getByRole('checkbox', { name: 'Mute' })).toHaveAttribute('type', 'checkbox');
    });
});
