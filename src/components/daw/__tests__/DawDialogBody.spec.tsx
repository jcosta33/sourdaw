import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DawDialogBody } from '../DawDialogBody';

describe('DawDialogBody', () => {
    it('renders the fixed dialog body contract without scrolling by default', () => {
        render(
            <DawDialogBody data-testid="dialog-body">
                <span>first</span>
                <span>second</span>
            </DawDialogBody>
        );

        const body = screen.getByTestId('dialog-body');

        expect(body.tagName).toBe('DIV');
        expect(body).toHaveClass('flex', 'min-h-0', 'flex-col', 'gap-4', 'bg-surface-base/40', 'px-4', 'py-4');
        expect(body).not.toHaveClass('overflow-y-auto');
        expect(Array.from(body.children, (child) => child.textContent)).toEqual(['first', 'second']);
    });

    it('adds vertical overflow only when scrolling is enabled', () => {
        render(
            <DawDialogBody data-testid="dialog-body" scrollable>
                body
            </DawDialogBody>
        );

        expect(screen.getByTestId('dialog-body')).toHaveClass('overflow-y-auto');
    });

    it('forwards native props, events, and styles', () => {
        const handleClick = vi.fn();

        render(
            <DawDialogBody
                data-testid="dialog-body"
                data-state="ready"
                aria-label="Dialog content"
                role="region"
                style={{ maxHeight: '320px' }}
                onClick={handleClick}
            >
                body
            </DawDialogBody>
        );

        const body = screen.getByRole('region', { name: 'Dialog content' });

        expect(body).toHaveAttribute('data-state', 'ready');
        expect(body).toHaveStyle({ maxHeight: '320px' });

        fireEvent.click(body);
        expect(handleClick).toHaveBeenCalledOnce();
    });

    it('lets caller classes override conflicting layout, overflow, background, and spacing hooks', () => {
        render(
            <DawDialogBody
                data-testid="dialog-body"
                scrollable
                className="min-h-full flex-row gap-2 overflow-hidden bg-black px-8 py-6"
            >
                body
            </DawDialogBody>
        );

        const body = screen.getByTestId('dialog-body');

        expect(body).toHaveClass('min-h-full', 'flex-row', 'gap-2', 'overflow-hidden', 'bg-black', 'px-8', 'py-6');
        expect(body).not.toHaveClass(
            'min-h-0',
            'flex-col',
            'gap-4',
            'overflow-y-auto',
            'bg-surface-base/40',
            'px-4',
            'py-4'
        );
    });
});
