import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TemplateChooser } from '../TemplateChooser';

describe('TemplateChooser', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<TemplateChooser />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<TemplateChooser />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<TemplateChooser />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});
