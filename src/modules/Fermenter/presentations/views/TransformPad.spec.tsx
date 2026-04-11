import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TransformPad } from './TransformPad';

vi.mock('../../useCases/presetMorph/applyMorphedPatch', () => ({
    applyMorphedPatch: vi.fn(),
}));

vi.mock('../../useCases/presetMorph/bilinearPatch', () => ({
    bilinearPatch: vi.fn(() => ({ name: 'Morphed' })),
}));

vi.mock('../../useCases/fermenterQueries/helpers', () => ({
    FERMENTER_PRESETS: [
        { id: 'fermenter-init', name: 'Fermenter — Init', devices: [{ parameterValues: {} }] },
        { id: 'fermenter-supersaw', name: 'Fermenter — Supersaw', devices: [{ parameterValues: {} }] },
        { id: 'fermenter-dark-drone', name: 'Fermenter — Dark Drone', devices: [{ parameterValues: {} }] },
        { id: 'fermenter-acid-bass', name: 'Fermenter — Acid Bass', devices: [{ parameterValues: {} }] },
    ],
}));

describe('TransformPad', () => {
    const mockDeviceId = 'device-123';

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<TransformPad deviceId={mockDeviceId} />);
        expect(screen.getByText(/Scene morph/i)).toBeInTheDocument();
    });

    it('should render canvas element', () => {
        render(<TransformPad deviceId={mockDeviceId} />);
        expect(document.querySelector('canvas')).toBeInTheDocument();
    });

    it('should display Four corners label', () => {
        render(<TransformPad deviceId={mockDeviceId} />);
        expect(screen.getByText(/Four corners/i)).toBeInTheDocument();
    });

    it('should handle pointer down on canvas', () => {
        render(<TransformPad deviceId={mockDeviceId} />);
        const canvas = document.querySelector('canvas');
        expect(canvas).toBeInTheDocument();
        
        if (canvas) {
            fireEvent.pointerDown(canvas, { clientX: 80, clientY: 80, pointerId: 1 });
            expect(canvas).toHaveStyle({ cursor: 'grabbing' });
        }
    });

    it('should apply correct canvas dimensions', () => {
        render(<TransformPad deviceId={mockDeviceId} />);
        const canvas = document.querySelector('canvas') as HTMLCanvasElement;
        expect(canvas).toBeInTheDocument();
        expect(canvas.style.width).toBe('160px');
        expect(canvas.style.height).toBe('160px');
    });
});
