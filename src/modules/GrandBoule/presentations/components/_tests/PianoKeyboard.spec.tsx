import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { PianoKeyboard } from '../PianoKeyboard';

describe('PianoKeyboard', () => {
    it('should render', () => {
        const { container } = render(
            <PianoKeyboard onNoteOn={vi.fn()} onNoteOff={vi.fn()} highlightedNotes={new Set()} />
        );
        expect(container.querySelectorAll('button').length).toBeGreaterThan(0);
    });
});
