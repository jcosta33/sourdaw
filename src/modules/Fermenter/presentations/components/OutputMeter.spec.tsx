import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OutputMeter } from './OutputMeter';

describe('OutputMeter', () => {
    it('should render', () => {
        render(<OutputMeter peakL={0.5} peakR={0.3} height={32} />);
        expect(screen.getByText('L')).toBeInTheDocument();
    });
});
