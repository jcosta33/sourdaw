import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DawPickerRow } from '../DawPickerRow';

describe('DawPickerRow', () => {
    it('should render as anchor when href is set', () => {
        render(
            <DawPickerRow heading="Doc" href="https://example.com" target="_blank" rel="noreferrer" />
        );
        const link = screen.getByRole('link', { name: 'Doc' });
        expect(link).toHaveAttribute('href', 'https://example.com');
    });

    it('should render as button when onClick is set', () => {
        const onClick = vi.fn();
        render(<DawPickerRow heading="Item" onClick={onClick} />);
        fireEvent.click(screen.getByRole('button', { name: 'Item' }));
        expect(onClick).toHaveBeenCalled();
    });
});
