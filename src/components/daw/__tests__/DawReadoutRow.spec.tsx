import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { DawReadoutRow } from '../DawReadoutRow';

describe('DawReadoutRow', () => {
    it('should render label and value', () => {
        render(<DawReadoutRow label="CPU" value="12%" />);
        expect(screen.getByText('CPU')).toBeInTheDocument();
        expect(screen.getByText('12%')).toBeInTheDocument();
    });
});
