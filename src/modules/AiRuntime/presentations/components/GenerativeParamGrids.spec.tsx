import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GenreGrid } from './GenerativeParamGrids';

describe('GenerativeParamGrids', () => {
    it('should render', () => {
        const onChange = vi.fn();
        render(<GenreGrid value="" onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: /lo-fi/i }));
        expect(onChange).toHaveBeenCalled();
    });
});
