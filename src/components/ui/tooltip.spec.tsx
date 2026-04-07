import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from './tooltip';

describe('Tooltip', () => {
    it('should show tooltip content when open', () => {
        render(
            <TooltipProvider delayDuration={0}>
                <Tooltip open>
                    <TooltipTrigger>Target</TooltipTrigger>
                    <TooltipContent>Tooltip copy</TooltipContent>
                </Tooltip>
            </TooltipProvider>
        );
        expect(document.querySelector('[data-slot="tooltip-content"]')).toHaveTextContent('Tooltip copy');
    });
});
