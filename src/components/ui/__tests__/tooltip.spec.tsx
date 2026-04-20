import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '../tooltip';

vi.unmock('#/components/ui/tooltip');

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
