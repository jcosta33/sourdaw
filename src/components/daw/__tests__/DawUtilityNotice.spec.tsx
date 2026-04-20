import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { DawUtilityNotice } from '../DawUtilityNotice';

describe('DawUtilityNotice', () => {
    it('should render icon and dashed tone', () => {
        const { container } = render(
            <DawUtilityNotice icon={<span data-testid="ico">!</span>} tone="dashed">
                Note
            </DawUtilityNotice>
        );
        expect(screen.getByTestId('ico')).toBeInTheDocument();
        expect(screen.getByText('Note')).toBeInTheDocument();
        expect(container.firstChild).toHaveClass('border-dashed');
    });
});
