import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DawPickerRow } from '../DawPickerRow';

describe('DawPickerRow', () => {
    describe('element-type selection', () => {
        it('renders as an anchor when href is set, forwarding href/target/rel', () => {
            render(<DawPickerRow heading="Doc" href="https://example.com" target="_blank" rel="noreferrer" />);
            const link = screen.getByRole('link', { name: 'Doc' });
            expect(link.tagName).toBe('A');
            expect(link).toHaveAttribute('href', 'https://example.com');
            expect(link).toHaveAttribute('target', '_blank');
            expect(link).toHaveAttribute('rel', 'noreferrer');
        });

        it('renders as a button when onClick is set', () => {
            const onClick = vi.fn();
            render(<DawPickerRow heading="Item" onClick={onClick} />);
            const button = screen.getByRole('button', { name: 'Item' });
            expect(button.tagName).toBe('BUTTON');
            fireEvent.click(button);
            expect(onClick).toHaveBeenCalledOnce();
        });

        it('renders as a plain div (no button/link role) when neither href nor onClick is set', () => {
            render(<DawPickerRow heading="Label" />);
            expect(screen.queryByRole('link')).toBeNull();
            expect(screen.queryByRole('button')).toBeNull();
            expect(screen.getByText('Label').tagName).toBe('DIV');
        });

        it('prefers href over onClick when both are set (renders a link)', () => {
            const onClick = vi.fn();
            render(<DawPickerRow heading="Item" href="https://example.com" onClick={onClick} />);
            expect(screen.getByRole('link', { name: 'Item' })).toBeTruthy();
            expect(screen.queryByRole('button')).toBeNull();
        });
    });

    describe('active vs inactive styling', () => {
        it('applies the active border/background class when active is true', () => {
            render(<DawPickerRow heading="Item" active onClick={vi.fn()} />);
            const button = screen.getByRole('button', { name: 'Item' });
            expect(button.className).toContain('border-white/16');
            expect(button.className).toContain('bg-white/[0.04]');
        });

        it('applies the transparent-border hover class when active is false', () => {
            render(<DawPickerRow heading="Item" onClick={vi.fn()} />);
            const button = screen.getByRole('button', { name: 'Item' });
            expect(button.className).toContain('border-transparent');
            expect(button.className).toContain('hover:bg-white/[0.03]');
        });

        it('merges a custom className without clobbering the base variant classes', () => {
            render(<DawPickerRow heading="Item" className="my-custom" active onClick={vi.fn()} />);
            const button = screen.getByRole('button', { name: 'Item' });
            expect(button.className).toContain('my-custom');
            // active variant class survives the merge
            expect(button.className).toContain('bg-white/[0.04]');
        });
    });

    describe('compact vs non-compact padding', () => {
        it('uses compact padding (px-2 py-1.5) by default', () => {
            render(<DawPickerRow heading="Item" onClick={vi.fn()} />);
            expect(screen.getByRole('button', { name: 'Item' }).className).toContain('px-2 py-1.5');
        });

        it('uses expanded padding (px-3 py-2) and larger heading text when compact is false', () => {
            render(<DawPickerRow heading="Item" compact={false} onClick={vi.fn()} />);
            const button = screen.getByRole('button', { name: 'Item' });
            expect(button.className).toContain('px-3 py-2');
            expect(button.className).not.toContain('px-2 py-1.5');
            expect(screen.getByText('Item').className).toContain('text-[11px]');
        });

        it('uses the smaller heading text size when compact is true', () => {
            render(<DawPickerRow heading="Item" compact onClick={vi.fn()} />);
            expect(screen.getByText('Item').className).toContain('text-[10px]');
        });
    });

    describe('slots and description', () => {
        it('renders startSlot and endSlot when provided', () => {
            render(
                <DawPickerRow
                    heading="Item"
                    startSlot={<span data-testid="start">S</span>}
                    endSlot={<span data-testid="end">E</span>}
                    onClick={vi.fn()}
                />
            );
            expect(screen.getByTestId('start')).toBeTruthy();
            expect(screen.getByTestId('end')).toBeTruthy();
        });

        it('omits startSlot and endSlot wrappers when not provided', () => {
            render(<DawPickerRow heading="Item" onClick={vi.fn()} />);
            expect(screen.queryByTestId('start')).toBeNull();
            expect(screen.queryByTestId('end')).toBeNull();
        });

        it('renders the description with a tight leading/tracked muted style when provided (compact)', () => {
            render(<DawPickerRow heading="Item" description="Detail" onClick={vi.fn()} />);
            const desc = screen.getByText('Detail');
            expect(desc.className).toContain('text-muted-foreground/65');
            expect(desc.className).toContain('leading-tight');
            // compact=true → text-[9px]
            expect(desc.className).toContain('text-[9px]');
        });

        it('uses the larger description text size when compact is false', () => {
            render(<DawPickerRow heading="Item" description="Detail" compact={false} onClick={vi.fn()} />);
            expect(screen.getByText('Detail').className).toContain('text-[10px]');
        });

        it('does not render a description node when omitted', () => {
            render(<DawPickerRow heading="Item" onClick={vi.fn()} />);
            expect(screen.queryByText('Detail')).toBeNull();
        });
    });

    describe('passthrough attributes', () => {
        it('forwards title, role, and tabIndex onto the rendered element', () => {
            render(<DawPickerRow heading="Item" title="tooltip" role="separator" tabIndex={0} onClick={vi.fn()} />);
            const sep = screen.getByRole('separator');
            expect(sep).toHaveAttribute('title', 'tooltip');
            expect(sep).toHaveAttribute('tabindex', '0');
        });

        it('forwards onKeyDown onto the div fallback variant', () => {
            const onKeyDown = vi.fn();
            render(<DawPickerRow heading="Item" onKeyDown={onKeyDown} tabIndex={0} />);
            const div = screen.getByText('Item').closest('div');
            fireEvent.keyDown(div!, { key: 'Enter' });
            expect(onKeyDown).toHaveBeenCalledOnce();
        });
    });
});
