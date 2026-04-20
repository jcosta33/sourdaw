import { type ReactNode } from 'react';

import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DisabledFeatureWrapper } from '../disabled-feature-wrapper';

/** Radix only mounts tooltip content when open; synthetic hover is unreliable in jsdom. Stub primitives so we assert wiring. */
vi.mock('#/components/ui/tooltip', () => ({
    TooltipProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Tooltip: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    TooltipTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    TooltipContent: ({ children }: { children: ReactNode }) => <div data-slot="tooltip-content">{children}</div>,
}));

describe('DisabledFeatureWrapper', () => {
    it('should render children directly when not disabled', () => {
        render(
            <DisabledFeatureWrapper disabled={false} reason="n/a">
                <button type="button">Click me</button>
            </DisabledFeatureWrapper>
        );
        expect(screen.getByRole('button', { name: 'Click me' })).not.toBeDisabled();
    });

    it('should wrap disabled children and pass reason into tooltip content', () => {
        render(
            <DisabledFeatureWrapper disabled reason="Not on web">
                <button type="button">Native only</button>
            </DisabledFeatureWrapper>
        );
        expect(screen.getByRole('button', { name: 'Native only' })).toBeDisabled();
        expect(document.querySelector('[data-slot="tooltip-content"]')).toHaveTextContent('Not on web');
    });
});
