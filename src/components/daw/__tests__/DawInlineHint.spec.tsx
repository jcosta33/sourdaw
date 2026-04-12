import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DawInlineHint } from '../DawInlineHint';

describe('DawInlineHint', () => {
    it('should render children', () => {
        render(<DawInlineHint>Optional</DawInlineHint>);
        expect(screen.getByText('Optional')).toBeInTheDocument();
    });
});
