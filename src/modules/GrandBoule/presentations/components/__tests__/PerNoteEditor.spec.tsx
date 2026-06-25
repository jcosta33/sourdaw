import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { type GrandBoulePerNoteValues, createDefaultPerNoteValues } from '../../../models/GrandBoulePerNoteParams';
import { PerNoteEditor } from '../PerNoteEditor';

// Default selected key inside PerNoteEditor.
const SELECTED_KEY = 40;

const withKey = (key: number, values: GrandBoulePerNoteValues) =>
    new Map<number, GrandBoulePerNoteValues>([[key, values]]);

describe('PerNoteEditor', () => {
    it('should render', () => {
        render(<PerNoteEditor onParamChange={vi.fn()} onReset={vi.fn()} perNoteOverrides={new Map()} />);
        expect(screen.getByRole('button', { name: /reset/i })).toBeInTheDocument();
    });

    it('disables Reset when no override exists for the selected key', () => {
        render(<PerNoteEditor onParamChange={vi.fn()} onReset={vi.fn()} perNoteOverrides={new Map()} />);
        expect(screen.getByRole('button', { name: /reset/i })).toBeDisabled();
    });

    it('disables Reset when the map holds a functionally-default entry for the selected key', () => {
        // A lingering all-default entry must not enable Reset — hasOverrides
        // is a value diff, not a bare Map.has.
        const overrides = withKey(SELECTED_KEY, createDefaultPerNoteValues());
        render(<PerNoteEditor onParamChange={vi.fn()} onReset={vi.fn()} perNoteOverrides={overrides} />);
        expect(screen.getByRole('button', { name: /reset/i })).toBeDisabled();
    });

    it('enables Reset when a value deviates from default for the selected key', () => {
        const overrides = withKey(SELECTED_KEY, { ...createDefaultPerNoteValues(), hammerHardness: 1.5 });
        render(<PerNoteEditor onParamChange={vi.fn()} onReset={vi.fn()} perNoteOverrides={overrides} />);
        expect(screen.getByRole('button', { name: /reset/i })).toBeEnabled();
    });
});
