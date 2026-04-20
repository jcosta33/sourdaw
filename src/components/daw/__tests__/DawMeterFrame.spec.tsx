import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { DawMeterFrame } from '../DawMeterFrame';

describe('DawMeterFrame', () => {
    it('should render children and overlay', () => {
        render(
            <DawMeterFrame overlay="vertical">
                <span>meter</span>
            </DawMeterFrame>
        );
        expect(screen.getByText('meter')).toBeInTheDocument();
    });
});
