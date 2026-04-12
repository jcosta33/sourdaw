import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { renameTrack } from '../../../../useCases/renameTrack';
import { InlineTrackName } from '../InlineTrackName';

// Mock external dependencies
vi.mock('../../../../useCases/renameTrack', () => ({
    renameTrack: vi.fn(),
}));

const mockTrack = {
    id: 'track1',
    name: 'Test Track',
};

describe('InlineTrackName', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        const { container } = render(<InlineTrackName track={mockTrack} />);
        expect(container.firstChild).toBeTruthy();
    });

    it('should render track name', () => {
        render(<InlineTrackName track={mockTrack} />);
        expect(screen.getByText('Test Track')).toBeInTheDocument();
    });

    it('should show title on hover', () => {
        render(<InlineTrackName track={mockTrack} />);
        expect(screen.getByTitle('Double-click to rename')).toBeInTheDocument();
    });

    it('should enter edit mode on double click', () => {
        render(<InlineTrackName track={mockTrack} />);
        const name = screen.getByText('Test Track');
        fireEvent.doubleClick(name);
        const input = screen.getByLabelText('Rename track Test Track');
        expect(input).toBeInTheDocument();
        expect(input).toHaveValue('Test Track');
    });

    it('should commit rename on Enter key', () => {
        render(<InlineTrackName track={mockTrack} />);
        const name = screen.getByText('Test Track');
        fireEvent.doubleClick(name);
        const input = screen.getByLabelText('Rename track Test Track');
        fireEvent.change(input, { target: { value: 'New Name' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(renameTrack).toHaveBeenCalled();
    });

    it('should cancel rename on Escape key', () => {
        render(<InlineTrackName track={mockTrack} />);
        const name = screen.getByText('Test Track');
        fireEvent.doubleClick(name);
        const input = screen.getByLabelText('Rename track Test Track');
        fireEvent.change(input, { target: { value: 'New Name' } });
        fireEvent.keyDown(input, { key: 'Escape' });
        expect(renameTrack).not.toHaveBeenCalled();
        expect(screen.getByText('Test Track')).toBeInTheDocument();
    });

    it('should commit rename on blur', () => {
        render(<InlineTrackName track={mockTrack} />);
        const name = screen.getByText('Test Track');
        fireEvent.doubleClick(name);
        const input = screen.getByLabelText('Rename track Test Track');
        fireEvent.change(input, { target: { value: 'New Name' } });
        fireEvent.blur(input);
        expect(renameTrack).toHaveBeenCalled();
    });

    it('should not rename if value is empty', () => {
        render(<InlineTrackName track={mockTrack} />);
        const name = screen.getByText('Test Track');
        fireEvent.doubleClick(name);
        const input = screen.getByLabelText('Rename track Test Track');
        fireEvent.change(input, { target: { value: '' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(renameTrack).not.toHaveBeenCalled();
    });
});
