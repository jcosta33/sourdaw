import { render, screen, fireEvent, createEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { executeUserAppAction } from '#/modules/Command/useCases';

import { TrackDummy } from '../../../../__tests__/TrackDummy';
import { InlineTrackName } from '../InlineTrackName';

// Mock external dependencies
// The header rename dispatches through the command path (#4617); the
// assertions below pin the dispatched action, not the bare use case.
vi.mock('#/modules/Command/useCases', () => ({
    executeUserAppAction: vi.fn(),
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
        expect(executeUserAppAction).toHaveBeenCalled();
    });

    it('should cancel rename on Escape key', () => {
        render(<InlineTrackName track={mockTrack} />);
        const name = screen.getByText('Test Track');
        fireEvent.doubleClick(name);
        const input = screen.getByLabelText('Rename track Test Track');
        fireEvent.change(input, { target: { value: 'New Name' } });
        fireEvent.keyDown(input, { key: 'Escape' });
        expect(executeUserAppAction).not.toHaveBeenCalled();
        expect(screen.getByText('Test Track')).toBeInTheDocument();
    });

    it('should commit rename on blur', () => {
        render(<InlineTrackName track={mockTrack} />);
        const name = screen.getByText('Test Track');
        fireEvent.doubleClick(name);
        const input = screen.getByLabelText('Rename track Test Track');
        fireEvent.change(input, { target: { value: 'New Name' } });
        fireEvent.blur(input);
        expect(executeUserAppAction).toHaveBeenCalled();
    });

    it('should not rename if value is empty', () => {
        render(<InlineTrackName track={mockTrack} />);
        const name = screen.getByText('Test Track');
        fireEvent.doubleClick(name);
        const input = screen.getByLabelText('Rename track Test Track');
        fireEvent.change(input, { target: { value: '' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(executeUserAppAction).not.toHaveBeenCalled();
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

        expect(executeUserAppAction).toHaveBeenCalledWith({
            type: 'renameTrack',
            payload: { trackId: 'track1', name: 'New Name' },
        });
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

        expect(executeUserAppAction).not.toHaveBeenCalled();
        expect(preventDefaultSpy).toHaveBeenCalledTimes(1);
        expect(stopPropagationSpy).toHaveBeenCalledTimes(1);
        expect(escapeEvent.defaultPrevented).toBe(true);
        expect(screen.getByText('Test Track')).toBeInTheDocument();
    });
});
