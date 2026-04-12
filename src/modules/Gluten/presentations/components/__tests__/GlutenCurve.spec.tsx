import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { GlutenCurve } from '../GlutenCurve';

describe('GlutenCurve', () => {
    it('should render', () => {
        const { container } = render(
            <GlutenCurve threshold={-18} ratio={3} knee={2} makeup={0} grDb={0} inputDb={-12} width={120} height={80} />
        );
        expect(container.querySelector('canvas')).toBeTruthy();
    });
});
