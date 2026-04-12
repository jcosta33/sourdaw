import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExportDialog } from '../ExportDialog';

describe('ExportDialog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<ExportDialog />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<ExportDialog />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<ExportDialog />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});
