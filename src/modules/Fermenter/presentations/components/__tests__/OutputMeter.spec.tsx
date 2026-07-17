import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { OutputMeter } from '../OutputMeter';

describe('OutputMeter', () => {
    it('should render', () => {
        render(<OutputMeter deviceId="device-1" height={32} />);
        expect(screen.getByText('L')).toBeInTheDocument();
    });
});
