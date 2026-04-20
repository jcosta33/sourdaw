import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { PerNoteEditor } from '../PerNoteEditor';

describe('PerNoteEditor', () => {
    it('should render', () => {
        render(<PerNoteEditor onParamChange={vi.fn()} onReset={vi.fn()} perNoteOverrides={new Map()} />);
        expect(screen.getByRole('button', { name: /reset/i })).toBeInTheDocument();
    });
});
