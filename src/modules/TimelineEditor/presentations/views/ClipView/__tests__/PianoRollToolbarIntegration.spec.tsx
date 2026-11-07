import { useState } from 'react';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PianoRollToolbar } from '../PianoRollToolbar';

function ControlledToolbar() {
    const [snap, setSnap] = useState(0.25);
    const [root, setRoot] = useState(0);
    const [scale, setScale] = useState('chromatic');
    return (
        <PianoRollToolbar
            gridSnap={snap}
            onGridSnapChange={setSnap}
            scaleRoot={root}
            onScaleRootChange={setRoot}
            scaleType={scale}
            onScaleTypeChange={setScale}
            isFolded={false}
            onToggleFolded={vi.fn()}
            constrainToScale={false}
            onToggleConstrainToScale={vi.fn()}
            stepInput={false}
            onToggleStepInput={vi.fn()}
            showGhostNotes={false}
            onToggleGhostNotes={vi.fn()}
            chordMode={false}
            onToggleChordMode={vi.fn()}
            chordType="major"
            onChordTypeChange={vi.fn()}
            paintMode={false}
            onTogglePaintMode={vi.fn()}
            lassoMode={false}
            onToggleLassoMode={vi.fn()}
            notePreviewEnabled={false}
            onToggleNotePreview={vi.fn()}
            zoom={1}
            onZoomChange={vi.fn()}
        />
    );
}

describe('Piano roll toolbar controls', () => {
    // Covers the static zoom and snap obligations from pianoRollZoomTestId.
    it('renders the real slider and transitions the controlled snap', () => {
        render(<ControlledToolbar />);
        const zoom = screen.getByTestId('toolbar-zoom');
        const slider = within(zoom).getByRole('slider', { name: 'Piano roll zoom' });
        expect(slider).toHaveAttribute('aria-valuemin', '25');
        expect(slider).toHaveAttribute('aria-valuemax', '400');
        expect(slider).toHaveAttribute('aria-valuenow', '100');
        for (const label of ['1/4', '1/8', '1/16', '1/32']) {
            expect(screen.getByRole('button', { name: label, exact: true })).toBeInTheDocument();
        }
        const sixteenth = screen.getByRole('button', { name: '1/16' });
        const thirtySecond = screen.getByRole('button', { name: '1/32' });
        expect(sixteenth).toHaveAttribute('aria-pressed', 'true');
        expect(thirtySecond).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(thirtySecond);
        expect(thirtySecond).toHaveAttribute('aria-pressed', 'true');
        expect(sixteenth).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(sixteenth);
        expect(sixteenth).toHaveAttribute('aria-pressed', 'true');
        expect(thirtySecond).toHaveAttribute('aria-pressed', 'false');
    });

    it('updates the real root and scale selectors', () => {
        render(<ControlledToolbar />);
        const root = screen.getByLabelText('Scale root note');
        const scale = screen.getByLabelText('Scale type');
        expect(root).toHaveValue('0');
        expect(scale).toHaveValue('chromatic');
        expect(screen.getByRole('option', { name: 'D#' })).toHaveValue('3');
        fireEvent.change(root, { target: { value: '3' } });
        fireEvent.change(scale, { target: { value: 'minor' } });
        expect(root).toHaveValue('3');
        expect(scale).toHaveValue('minor');
    });
});
