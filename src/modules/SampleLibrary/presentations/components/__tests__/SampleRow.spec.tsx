import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { type SampleRecord } from '../../../models/LibraryTypes';
import { SampleRow } from '../SampleRow';

function createSample(overrides: Partial<SampleRecord> = {}): SampleRecord {
    return {
        id: 's1',
        libraryRootId: 'r1',
        relativePath: 'a.wav',
        displayName: 'a',
        ext: 'wav',
        folder: '/',
        sync: { exists: true, status: 'indexed' },
        format: { durationSec: 1.2 },
        tags: [],
        favorite: false,
        ...overrides,
    };
}

const baseProps = {
    showBrowserDecodeWarnings: false,
    onPlay: vi.fn(),
    onStop: vi.fn(),
    onToggleFavorite: vi.fn(),
    onFindSimilar: vi.fn(),
    onDragStart: vi.fn(),
    onClick: vi.fn(),
};

describe('SampleRow', () => {
    it('should render', () => {
        render(<SampleRow sample={createSample()} isPlaying={false} {...baseProps} />);
        expect(screen.getByText('a')).toBeTruthy();
    });

    it.each(['aiff', 'aif', 'flac', 'aac', 'm4a'])(
        'should show the browser risky-format badge for %s when browser warnings are enabled',
        (ext) => {
            render(
                <SampleRow sample={createSample({ ext })} isPlaying={false} {...baseProps} showBrowserDecodeWarnings />
            );
            expect(screen.getByTitle(`${ext.toUpperCase()} may not preview in your browser`)).toBeTruthy();
        }
    );
});

describe('SampleRow — play/stop toggle', () => {
    it('shows Play label when not playing and fires onPlay', () => {
        const onPlay = vi.fn();
        render(<SampleRow sample={createSample()} isPlaying={false} {...baseProps} onPlay={onPlay} />);
        const btn = screen.getByRole('button', { name: 'Play a' });
        fireEvent.click(btn);
        expect(onPlay).toHaveBeenCalledTimes(1);
    });

    it('shows Stop label when playing and fires onStop', () => {
        const onStop = vi.fn();
        render(<SampleRow sample={createSample()} isPlaying {...baseProps} onStop={onStop} />);
        const btn = screen.getByRole('button', { name: 'Stop a' });
        fireEvent.click(btn);
        expect(onStop).toHaveBeenCalledTimes(1);
    });
});

describe('SampleRow — favorite toggle', () => {
    it('shows Add to favorites when not favorite', () => {
        render(<SampleRow sample={createSample({ favorite: false })} isPlaying={false} {...baseProps} />);
        expect(screen.getByRole('button', { name: 'Add a to favorites' })).toBeTruthy();
    });

    it('shows Remove from favorites when favorite', () => {
        render(<SampleRow sample={createSample({ favorite: true })} isPlaying={false} {...baseProps} />);
        expect(screen.getByRole('button', { name: 'Remove a from favorites' })).toBeTruthy();
    });

    it('fires onToggleFavorite when clicked', () => {
        const onToggleFavorite = vi.fn();
        render(
            <SampleRow sample={createSample()} isPlaying={false} {...baseProps} onToggleFavorite={onToggleFavorite} />
        );
        fireEvent.click(screen.getByRole('button', { name: 'Add a to favorites' }));
        expect(onToggleFavorite).toHaveBeenCalledTimes(1);
    });
});

describe('SampleRow — metadata display', () => {
    it('shows rounded BPM when analysis.bpm is present', () => {
        render(
            <SampleRow
                sample={createSample({ analysis: { bpm: 123.6 as never, key: undefined } })}
                isPlaying={false}
                {...baseProps}
            />
        );
        expect(screen.getByText('124')).toBeTruthy();
    });

    it('shows musical key when analysis.key is present', () => {
        render(
            <SampleRow
                sample={createSample({ analysis: { bpm: undefined, key: 'Am' as never } })}
                isPlaying={false}
                {...baseProps}
            />
        );
        expect(screen.getByText('Am')).toBeTruthy();
    });

    it('formats duration under 1 second as milliseconds', () => {
        render(<SampleRow sample={createSample({ format: { durationSec: 0.5 } })} isPlaying={false} {...baseProps} />);
        expect(screen.getByText('500ms')).toBeTruthy();
    });

    it('formats duration over 60 seconds as m:ss', () => {
        render(<SampleRow sample={createSample({ format: { durationSec: 125 } })} isPlaying={false} {...baseProps} />);
        expect(screen.getByText('2:05')).toBeTruthy();
    });

    it('formats file size in KB when under 1MB', () => {
        render(
            <SampleRow
                sample={createSample({ sync: { exists: true, status: 'indexed', sizeBytes: 5120 } })}
                isPlaying={false}
                {...baseProps}
            />
        );
        expect(screen.getByText('5KB')).toBeTruthy();
    });
});

describe('SampleRow — add-to-track conditional', () => {
    it('does not render the Add to track button when onAddToTrack is not provided', () => {
        render(<SampleRow sample={createSample()} isPlaying={false} {...baseProps} />);
        expect(screen.queryByRole('button', { name: 'Add a to track' })).toBeNull();
    });

    it('renders the Add to track button when onAddToTrack is provided', () => {
        render(<SampleRow sample={createSample()} isPlaying={false} {...baseProps} onAddToTrack={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'Add a to track' })).toBeTruthy();
    });
});
