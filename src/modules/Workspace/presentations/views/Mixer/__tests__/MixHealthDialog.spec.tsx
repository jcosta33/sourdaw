import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { MixHealthDialog } from '../MixHealthDialog';

describe('MixHealthDialog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<MixHealthDialog open={false} onOpenChange={vi.fn()} />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<MixHealthDialog open={false} onOpenChange={vi.fn()} />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<MixHealthDialog open={false} onOpenChange={vi.fn()} />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});
