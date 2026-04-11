import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DawKeycap } from '../DawKeycap';

describe('DawKeycap', () => {
    it('should render kbd content', () => {
        render(<DawKeycap>⌘K</DawKeycap>);
        expect(screen.getByText('⌘K').tagName).toBe('KBD');
    });
});
