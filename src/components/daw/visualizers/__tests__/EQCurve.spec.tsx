import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { EQCurve } from '../EQCurve';

describe('EQCurve', () => {
    it('should render canvas', () => {
        const { container } = render(
            <EQCurve
                lowGain={0}
                lowFreq={120}
                lowQ={0.7}
                midGain={0}
                midFreq={1000}
                midQ={1}
                highGain={0}
                highFreq={8000}
                highQ={0.7}
            />
        );
        expect(container.querySelector('canvas')).toBeInTheDocument();
    });
});
