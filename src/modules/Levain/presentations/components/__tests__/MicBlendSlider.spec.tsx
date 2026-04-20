import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { createDefaultPatch } from '../../../models/LevainPatch';
import { MicBlendSlider } from '../MicBlendSlider';

describe('MicBlendSlider', () => {
    it('should render', () => {
        const patch = createDefaultPatch('violin-1');
        render(
            <MicBlendSlider micPositions={patch.micPositions} onSendMicParam={vi.fn()} onUpdateMicPosition={vi.fn()} />
        );
        expect(screen.getByText(/close/i)).toBeInTheDocument();
    });
});
