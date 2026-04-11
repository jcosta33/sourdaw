import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { StringVibrationView } from '../StringVibrationView';

describe('StringVibrationView', () => {
    it('should render', () => {
        const { container } = render(<StringVibrationView activeNotes={new Map()} />);
        expect(container.querySelector('canvas')).toBeTruthy();
    });
});
