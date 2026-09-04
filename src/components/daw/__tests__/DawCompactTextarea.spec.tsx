import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { DawCompactTextarea } from '../DawCompactTextarea';

describe('DawCompactTextarea', () => {
    it('should render textarea with monospace when requested', () => {
        render(<DawCompactTextarea monospace defaultValue="x" aria-label="Notes" />);
        expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveClass('font-mono');
    });

    it('applies focus-visible ring styles for keyboard navigation', () => {
        render(<DawCompactTextarea aria-label="Notes" />);
        expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveClass(
            'focus-visible:ring-1',
            'focus-visible:ring-border-focus/70'
        );
    });
});
