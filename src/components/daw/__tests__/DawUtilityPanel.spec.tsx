import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { DawUtilityPanel } from '../DawUtilityPanel';

describe('DawUtilityPanel', () => {
    it('should render children', () => {
        render(<DawUtilityPanel>panel</DawUtilityPanel>);
        expect(screen.getByText('panel')).toBeInTheDocument();
    });
});
