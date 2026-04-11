import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DawCompactTextarea } from '../DawCompactTextarea';

describe('DawCompactTextarea', () => {
    it('should render textarea with monospace when requested', () => {
        render(<DawCompactTextarea monospace defaultValue="x" aria-label="Notes" />);
        expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveClass('font-mono');
    });
});
