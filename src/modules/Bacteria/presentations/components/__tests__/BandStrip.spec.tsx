import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DEFAULT_BAND } from '../../../models/BacteriaPatch';
import { BandStrip } from '../BandStrip';

describe('BandStrip', () => {
    it('should render', () => {
        render(<BandStrip index={0} band={DEFAULT_BAND} isActive onSelect={vi.fn()} onParamChange={vi.fn()} />);
        expect(screen.getByText(/band 1/i)).toBeInTheDocument();
        fireEvent.click(screen.getByText('S'));
    });
});
