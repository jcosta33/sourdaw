import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CrustGainStrip } from './CrustGainStrip';

describe('CrustGainStrip', () => {
    it('should render', () => {
        const onChange = vi.fn();
        render(<CrustGainStrip value={6} onChange={onChange} />);
        expect(screen.getByText(/gain/i)).toBeInTheDocument();
    });
});
