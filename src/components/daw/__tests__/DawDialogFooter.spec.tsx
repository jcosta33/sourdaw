import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { DawDialogFooter } from '../DawDialogFooter';

describe('DawDialogFooter', () => {
    it('should apply align and tone classes', () => {
        const { container } = render(
            <DawDialogFooter align="end" tone="warm">
                x
            </DawDialogFooter>
        );
        expect(container.firstChild).toHaveClass('justify-end');
        expect(container.firstChild).toHaveClass('border-orange-900/30');
    });
});
