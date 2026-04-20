import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { OverallLevel } from '../MixAnalysisSections';

describe('MixAnalysisSections', () => {
    it('should render', () => {
        render(<OverallLevel level={{ peakDb: -3.2, rmsDb: -12.4 }} />);
        expect(screen.getByText(/master level/i)).toBeInTheDocument();
    });
});
