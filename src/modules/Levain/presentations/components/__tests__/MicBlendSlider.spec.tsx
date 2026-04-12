import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MicBlendSlider } from '../MicBlendSlider';
import { createDefaultPatch } from '../../../models/LevainPatch';

describe('MicBlendSlider', () => {
    it('should render', () => {
        const patch = createDefaultPatch('violin-1');
        render(
            <MicBlendSlider
                micPositions={patch.micPositions}
                onSendMicParam={vi.fn()}
                onUpdateMicPosition={vi.fn()}
            />
        );
        expect(screen.getByText(/close/i)).toBeInTheDocument();
    });
});
