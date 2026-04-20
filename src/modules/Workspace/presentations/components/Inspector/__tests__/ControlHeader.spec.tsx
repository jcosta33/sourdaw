import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { ControlHeader } from '../ControlHeader';

describe('ControlHeader', () => {
    it('should render label and optional value', () => {
        render(<ControlHeader label="Cutoff" value="440 Hz" />);
        expect(screen.getByText('Cutoff')).toBeInTheDocument();
        expect(screen.getByText('440 Hz')).toBeInTheDocument();
    });
});
