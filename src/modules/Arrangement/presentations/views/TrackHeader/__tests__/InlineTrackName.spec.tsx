import { render, screen, fireEvent, createEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TrackDummy } from '../../../../__tests__/TrackDummy';
import { renameTrack } from '../../../../useCases/renameTrack';
import { InlineTrackName } from '../InlineTrackName';

// Mock external dependencies
vi.mock('../../../../useCases/renameTrack', () => ({
    renameTrack: vi.fn(),
}));

const mockTrack = TrackDummy.create({ id: 'track1', name: 'Test Track' });

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

    it('commits rename with preventDefault and stopPropagation on Enter', () => {
        render(<InlineTrackName track={mockTrack} />);
        const name = screen.getByText('Test Track');
        fireEvent.doubleClick(name);
        const input = screen.getByLabelText('Rename track Test Track');
        fireEvent.change(input, { target: { value: 'New Name' } });
        const enterEvent = createEvent.keyDown(input, { key: 'Enter', cancelable: true });
        const preventDefaultSpy = vi.spyOn(enterEvent, 'preventDefault');
        const stopPropagationSpy = vi.spyOn(enterEvent, 'stopPropagation');
        fireEvent(input, enterEvent);

        expect(renameTrack).toHaveBeenCalledWith('track1', 'New Name');
        expect(preventDefaultSpy).toHaveBeenCalledTimes(1);
        expect(stopPropagationSpy).toHaveBeenCalledTimes(1);
        expect(enterEvent.defaultPrevented).toBe(true);
    });

    it('cancels rename with preventDefault and stopPropagation on Escape', () => {
        render(<InlineTrackName track={mockTrack} />);
        const name = screen.getByText('Test Track');
        fireEvent.doubleClick(name);
        const input = screen.getByLabelText('Rename track Test Track');
        fireEvent.change(input, { target: { value: 'New Name' } });
        const escapeEvent = createEvent.keyDown(input, { key: 'Escape', cancelable: true });
        const preventDefaultSpy = vi.spyOn(escapeEvent, 'preventDefault');
        const stopPropagationSpy = vi.spyOn(escapeEvent, 'stopPropagation');
        fireEvent(input, escapeEvent);

        expect(renameTrack).not.toHaveBeenCalled();
        expect(preventDefaultSpy).toHaveBeenCalledTimes(1);
        expect(stopPropagationSpy).toHaveBeenCalledTimes(1);
        expect(escapeEvent.defaultPrevented).toBe(true);
        expect(screen.getByText('Test Track')).toBeInTheDocument();
    });
});
