import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
} from './dropdown-menu';

describe('DropdownMenu', () => {
    it('should open and invoke item select', async () => {
        const onSelect = vi.fn();
        render(
            <DropdownMenu>
                <DropdownMenuTrigger>Open menu</DropdownMenuTrigger>
                <DropdownMenuContent>
                    <DropdownMenuLabel>Section</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={onSelect}>First</DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        );

        fireEvent.pointerDown(screen.getByRole('button', { name: 'Open menu' }), { pointerId: 1 });
        await waitFor(() => {
            expect(screen.getByRole('menuitem', { name: 'First' })).toBeInTheDocument();
        });
        fireEvent.click(screen.getByRole('menuitem', { name: 'First' }));
        expect(onSelect).toHaveBeenCalled();
    });
});
