import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { StringVibrationView } from '../StringVibrationView';

describe('StringVibrationView — canvas structure', () => {
    it('renders a canvas with aria-label', () => {
        render(<StringVibrationView activeNotes={new Map()} />);
        expect(screen.getByLabelText('Grand Boule string vibration visualisation')).toBeInTheDocument();
    });

    it('renders without crashing with active notes', () => {
        const notes = new Map<number, number>([[60, 0.8]]);
        expect(() => render(<StringVibrationView activeNotes={notes} />)).not.toThrow();
    });

    it('renders without crashing with empty notes map', () => {
        expect(() => render(<StringVibrationView activeNotes={new Map()} />)).not.toThrow();
    });

    it('passes className to container', () => {
        const { container } = render(<StringVibrationView activeNotes={new Map()} className="custom-class" />);
        expect((container.firstChild as HTMLElement).className).toContain('custom-class');
    });

    it('canvas has full-size classes', () => {
        render(<StringVibrationView activeNotes={new Map()} />);
        const canvas = screen.getByLabelText('Grand Boule string vibration visualisation');
        expect(canvas.className).toContain('w-full');
        expect(canvas.className).toContain('h-full');
    });
});
