import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProjectLoadingOverlay } from '../ProjectLoadingOverlay';

describe('ProjectLoadingOverlay', () => {
    it('should render branding and a loading quip', () => {
        const { container } = render(<ProjectLoadingOverlay />);
        expect(screen.getByText('Sourdaw')).toBeInTheDocument();
        expect(container.textContent).toMatch(/\.\.\./);
    });
});
