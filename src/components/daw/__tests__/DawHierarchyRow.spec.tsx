import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DawHierarchyRow } from '../DawHierarchyRow';

describe('DawHierarchyRow', () => {
    it('should render as button by default', () => {
        const onClick = vi.fn();
        render(<DawHierarchyRow title="Bus 1" onClick={onClick} />);
        fireEvent.click(screen.getByRole('button', { name: 'Bus 1' }));
        expect(onClick).toHaveBeenCalled();
    });

    it('should render as div when as is div', () => {
        render(
            <DawHierarchyRow as="div" title="Folder">
                child
            </DawHierarchyRow>
        );
        expect(screen.queryByRole('button')).toBeNull();
        expect(screen.getByText('Folder')).toBeInTheDocument();
    });
});
