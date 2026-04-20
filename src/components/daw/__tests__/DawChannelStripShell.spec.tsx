import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { DawChannelStripShell } from '../DawChannelStripShell';

describe('DawChannelStripShell', () => {
    it('should render accent bar and children', () => {
        render(
            <DawChannelStripShell accentColor="#0a0" selected>
                <span>strip</span>
            </DawChannelStripShell>
        );
        expect(screen.getByText('strip')).toBeInTheDocument();
        expect(screen.getByRole('group')).toHaveClass('ring-ring');
    });
});
