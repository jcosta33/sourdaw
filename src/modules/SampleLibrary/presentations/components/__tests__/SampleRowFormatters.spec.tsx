import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { SampleRow } from '../SampleRow';

import type { SampleRecord } from '../../../models/LibraryTypes';

/**
 * Specs for SampleRow's display formatting and interaction branches.
 * The existing spec only covers the risky-format badge. These cover
 * formatDuration (4 branches), formatSize (3 branches), play/stop toggle,
 * favorite toggle, and conditional add-to-track button.
 */

function makeSample(overrides: Partial<SampleRecord> = {}): SampleRecord {
    return {
        id: 's1',
        libraryRootId: 'root1',
        relativePath: 'folder/kick.wav',
        displayName: 'Kick',
        ext: 'wav',
        folder: 'folder',
        sync: { exists: true, status: 'indexed' },
        format: {},
        ...overrides,
    } as SampleRecord;
}

function renderRow(sample: SampleRecord, props: Record<string, unknown> = {}) {
    render(
        <SampleRow
            sample={sample}
            isPlaying={false}
            showBrowserDecodeWarnings={false}
            onPlay={vi.fn()}
            onStop={vi.fn()}
            onToggleFavorite={vi.fn()}
            onFindSimilar={vi.fn()}
            onDragStart={vi.fn()}
            onClick={vi.fn()}
            {...props}
        />
    );
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('SampleRow — formatDuration display', () => {
    it('shows nothing for missing duration', () => {
        renderRow(makeSample({ format: {} }));
        // No duration text rendered.
        expect(screen.queryByText(/\d+\.\d+s/)).toBeNull();
    });

    it('shows milliseconds for sub-second durations (< 1s)', () => {
        renderRow(makeSample({ format: { durationSec: 0.5 } }));
        expect(screen.getByText('500ms')).toBeInTheDocument();
    });

    it('shows seconds for durations between 1 and 60', () => {
        renderRow(makeSample({ format: { durationSec: 2.5 } }));
        expect(screen.getByText('2.5s')).toBeInTheDocument();
    });

    it('shows m:ss for durations >= 60 seconds', () => {
        renderRow(makeSample({ format: { durationSec: 65 } }));
        // 65s = 1:05
        expect(screen.getByText('1:05')).toBeInTheDocument();
    });

    it('zero-pads seconds in m:ss format', () => {
        renderRow(makeSample({ format: { durationSec: 120 } }));
        // 120s = 2:00
        expect(screen.getByText('2:00')).toBeInTheDocument();
    });
});

describe('SampleRow — formatSize display', () => {
    it('shows nothing for missing size', () => {
        renderRow(makeSample({ sync: { exists: true, status: 'indexed' } }));
        // No size text.
        expect(screen.queryByText(/\d+B/)).toBeNull();
    });

    it('shows bytes for size < 1024', () => {
        renderRow(makeSample({ sync: { exists: true, status: 'indexed', sizeBytes: 512 } }));
        expect(screen.getByText('512B')).toBeInTheDocument();
    });

    it('shows KB for size between 1024 and 1MB', () => {
        renderRow(makeSample({ sync: { exists: true, status: 'indexed', sizeBytes: 5120 } }));
        // 5120 / 1024 = 5 KB
        expect(screen.getByText('5KB')).toBeInTheDocument();
    });

    it('shows MB for size >= 1MB', () => {
        renderRow(makeSample({ sync: { exists: true, status: 'indexed', sizeBytes: 2 * 1024 * 1024 } }));
        expect(screen.getByText('2.0MB')).toBeInTheDocument();
    });
});

describe('SampleRow — play/stop toggle', () => {
    it('shows Play aria-label when not playing', () => {
        renderRow(makeSample(), { isPlaying: false });
        expect(screen.getByRole('button', { name: /play/i })).toBeInTheDocument();
    });

    it('shows Stop aria-label when playing', () => {
        renderRow(makeSample(), { isPlaying: true });
        expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument();
    });

    it('calls onPlay when play button clicked', () => {
        const onPlay = vi.fn();
        renderRow(makeSample(), { isPlaying: false, onPlay });
        fireEvent.click(screen.getByRole('button', { name: /play/i }));
        expect(onPlay).toHaveBeenCalledTimes(1);
    });

    it('calls onStop when stop button clicked', () => {
        const onStop = vi.fn();
        renderRow(makeSample(), { isPlaying: true, onStop });
        fireEvent.click(screen.getByRole('button', { name: /stop/i }));
        expect(onStop).toHaveBeenCalledTimes(1);
    });
});

describe('SampleRow — favorite toggle', () => {
    it('calls onToggleFavorite when favorite button clicked', () => {
        const onToggleFavorite = vi.fn();
        renderRow(makeSample(), { onToggleFavorite });
        const favButton = screen.getByRole('button', { name: /favorite/i });
        fireEvent.click(favButton);
        expect(onToggleFavorite).toHaveBeenCalledTimes(1);
    });
});

describe('SampleRow — conditional add-to-track button', () => {
    it('does not render add-to-track button when onAddToTrack is not provided', () => {
        renderRow(makeSample());
        expect(screen.queryByRole('button', { name: /to track/i })).toBeNull();
    });

    it('renders add-to-track button when onAddToTrack is provided', () => {
        renderRow(makeSample(), { onAddToTrack: vi.fn() });
        expect(screen.getByRole('button', { name: /to track/i })).toBeInTheDocument();
    });

    it('calls onAddToTrack when clicked', () => {
        const onAddToTrack = vi.fn();
        renderRow(makeSample(), { onAddToTrack });
        fireEvent.click(screen.getByRole('button', { name: /to track/i }));
        expect(onAddToTrack).toHaveBeenCalledTimes(1);
    });
});
