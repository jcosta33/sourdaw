import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(),
}));

vi.mock('../../../useCases/proposeYeastGrooveExtraction', () => ({
    proposeYeastGrooveExtraction: vi.fn(),
}));

vi.mock('../../../useCases/commitYeastGrooveExtraction', () => ({
    commitYeastGrooveExtraction: vi.fn(),
}));

import { useStore } from '#/infra/store/useStore';

import { proposeYeastGrooveExtraction } from '../../../useCases/proposeYeastGrooveExtraction';
import { GrooveDropTarget } from '../GrooveDropTarget';

const mockedUseStore = vi.mocked(useStore);
const mockedPropose = vi.mocked(proposeYeastGrooveExtraction);

function setTrackState(
    tracks: Array<{
        id: string;
        name: string;
        clips: Array<{ id: string; name: string; type: string; isGhost?: boolean }>;
    }> = []
): void {
    mockedUseStore.mockReturnValue({ tracks });
}

beforeEach(() => {
    vi.clearAllMocks();
    setTrackState();
    mockedPropose.mockReturnValue({ status: 'ineligible-clip', clipId: 'x' } as never);
});

describe('GrooveDropTarget — drop zone', () => {
    it('renders drop zone with aria-label', () => {
        render(<GrooveDropTarget />);
        expect(screen.getByLabelText('Extract groove from MIDI clip')).toBeInTheDocument();
    });

    it('shows drop instruction text', () => {
        render(<GrooveDropTarget />);
        expect(screen.getByText('Drop MIDI clip to extract groove')).toBeInTheDocument();
    });
});

describe('GrooveDropTarget — MIDI clip select', () => {
    it('renders a select element for MIDI clips', () => {
        render(<GrooveDropTarget />);
        expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    it('populates select options with track — clip names', () => {
        setTrackState([
            { id: 't1', name: 'Drums', clips: [{ id: 'c1', name: 'Beat', type: 'midi' }] },
            { id: 't2', name: 'Bass', clips: [{ id: 'c2', name: 'Line', type: 'midi' }] },
        ]);
        render(<GrooveDropTarget />);
        expect(screen.getByRole('option', { name: /Drums — Beat/i })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: /Bass — Line/i })).toBeInTheDocument();
    });

    it('excludes ghost clips from the select', () => {
        setTrackState([
            {
                id: 't1',
                name: 'Drums',
                clips: [
                    { id: 'c1', name: 'Real', type: 'midi', isGhost: false },
                    { id: 'c2', name: 'Ghost', type: 'midi', isGhost: true },
                ],
            },
        ]);
        render(<GrooveDropTarget />);
        expect(screen.getByRole('option', { name: /Drums — Real/i })).toBeInTheDocument();
        expect(screen.queryByRole('option', { name: /Drums — Ghost/i })).toBeNull();
    });

    it('excludes non-MIDI clips from the select', () => {
        setTrackState([
            {
                id: 't1',
                name: 'Drums',
                clips: [
                    { id: 'c1', name: 'Midi', type: 'midi' },
                    { id: 'c2', name: 'Audio', type: 'audio' },
                ],
            },
        ]);
        render(<GrooveDropTarget />);
        expect(screen.getByRole('option', { name: /Drums — Midi/i })).toBeInTheDocument();
        expect(screen.queryByRole('option', { name: /Drums — Audio/i })).toBeNull();
    });
});

describe('GrooveDropTarget — preview button', () => {
    it('disables preview button when no clip is selected', () => {
        render(<GrooveDropTarget />);
        expect(screen.getByRole('button', { name: /preview/i })).toBeDisabled();
    });

    it('enables preview button when a MIDI clip is selected', () => {
        setTrackState([{ id: 't1', name: 'Drums', clips: [{ id: 'c1', name: 'Beat', type: 'midi' }] }]);
        render(<GrooveDropTarget />);
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'c1' } });
        expect(screen.getByRole('button', { name: /preview/i })).toBeEnabled();
    });

    it('does not show proposal message before preview', () => {
        render(<GrooveDropTarget />);
        expect(screen.queryByRole('status')).toBeNull();
    });
});

describe('GrooveDropTarget — proposal messages', () => {
    it('shows extracted proposal message after preview', () => {
        setTrackState([{ id: 't1', name: 'Drums', clips: [{ id: 'c1', name: 'Beat', type: 'midi' }] }]);
        mockedPropose.mockReturnValue({
            status: 'extracted',
            template: { name: 'Funky Groove', id: 'g1' },
            sourceRevision: 'rev1',
            clipId: 'c1',
            sourceName: 'Drums — Beat',
            subdivision: '1/16',
        } as never);
        render(<GrooveDropTarget />);
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'c1' } });
        fireEvent.click(screen.getByRole('button', { name: /preview/i }));
        expect(screen.getByRole('status')).toHaveTextContent('Funky Groove');
    });

    it('shows straight proposal message after preview', () => {
        setTrackState([{ id: 't1', name: 'Drums', clips: [{ id: 'c1', name: 'Beat', type: 'midi' }] }]);
        mockedPropose.mockReturnValue({
            status: 'straight',
            template: { name: 'Straight', id: 'straight' },
            sourceRevision: 'rev1',
            clipId: 'c1',
            sourceName: 'Drums — Beat',
            subdivision: '1/16',
        } as never);
        render(<GrooveDropTarget />);
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'c1' } });
        fireEvent.click(screen.getByRole('button', { name: /preview/i }));
        expect(screen.getByRole('status')).toHaveTextContent('already Straight');
    });

    it('shows save/cancel buttons when proposal is extracted', () => {
        setTrackState([{ id: 't1', name: 'Drums', clips: [{ id: 'c1', name: 'Beat', type: 'midi' }] }]);
        mockedPropose.mockReturnValue({
            status: 'extracted',
            template: { name: 'G', id: 'g1' },
            sourceRevision: 'rev1',
            clipId: 'c1',
            sourceName: 'D',
            subdivision: '1/16',
        } as never);
        render(<GrooveDropTarget />);
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'c1' } });
        fireEvent.click(screen.getByRole('button', { name: /preview/i }));
        expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    });

    it('does not show save button for non-extracted proposal', () => {
        setTrackState([{ id: 't1', name: 'Drums', clips: [{ id: 'c1', name: 'Beat', type: 'midi' }] }]);
        mockedPropose.mockReturnValue({
            status: 'empty',
            sourceRevision: 'rev1',
            clipId: 'c1',
            sourceName: 'D',
            subdivision: '1/16',
        } as never);
        render(<GrooveDropTarget />);
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'c1' } });
        fireEvent.click(screen.getByRole('button', { name: /preview/i }));
        expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
    });
});
