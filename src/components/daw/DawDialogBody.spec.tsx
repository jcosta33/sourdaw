import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { DawDialogBody } from './DawDialogBody';

describe('DawDialogBody', () => {
    it('should add overflow-y-auto when scrollable', () => {
        const { container } = render(<DawDialogBody scrollable>Body</DawDialogBody>);
        expect(container.firstChild).toHaveClass('overflow-y-auto');
    });
});
