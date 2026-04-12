import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DawPluginChip } from '../DawPluginChip';

describe('DawPluginChip', () => {
    it('should render active tone and click', () => {
        const onClick = vi.fn();
        render(
            <DawPluginChip active tone="cyan" onClick={onClick}>
                Edit
            </DawPluginChip>
        );
        expect(screen.getByRole('button', { name: 'Edit' })).toHaveClass('text-[var(--color-accent-cyan)]');
        fireEvent.click(screen.getByRole('button'));
        expect(onClick).toHaveBeenCalled();
    });
});
