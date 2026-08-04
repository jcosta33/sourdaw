import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../PreviewButton', () => ({
    PreviewButton: ({ onPlay }: { onPlay: () => void }) => (
        <button type="button" data-testid="preview-btn" onClick={onPlay}>
            Preview
        </button>
    ),
}));

import { PresetItem } from '../PresetItem';

import type { SoundPresetView as SoundPreset } from '../../../../models/SoundPresetViewTypes';

function makePreset(overrides: Partial<SoundPreset> = {}): SoundPreset {
    return {
        id: 'p1',
        name: 'Warm Pad',
        category: 'synth',
        trackKind: 'midi',
        devices: [
            { name: 'Fermenter', type: 'fermenter' },
            { name: 'Gluten', type: 'gluten' },
        ],
        ...overrides,
    } as SoundPreset;
}

function makePreview(overrides: Record<string, unknown> = {}) {
    return {
        playingId: null,
        play: vi.fn(),
        playTone: vi.fn(),
        playFile: vi.fn(),
        stop: vi.fn(),
        ...overrides,
    };
}

function renderItem(overrides: Record<string, unknown> = {}) {
    const onClick = vi.fn();
    const onToggleFavorite = vi.fn();
    render(
        <PresetItem
            preset={makePreset()}
            selectedTrackId="track-1"
            favorites={new Set<string>()}
            onToggleFavorite={onToggleFavorite}
            onClick={onClick}
            preview={makePreview()}
            {...overrides}
        />
    );
    return { onClick, onToggleFavorite };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('PresetItem — device chain summary', () => {
    it('renders device names joined with arrow', () => {
        renderItem();
        expect(screen.getByText('Fermenter → Gluten')).toBeInTheDocument();
    });
});

describe('PresetItem — category badge', () => {
    it('renders category badge when hideCategory is false', () => {
        renderItem();
        expect(screen.getByText('synth')).toBeInTheDocument();
    });

    it('hides category badge when hideCategory is true', () => {
        renderItem({ hideCategory: true });
        expect(screen.queryByText('synth')).toBeNull();
    });
});

describe('PresetItem — favorite toggle', () => {
    it('shows "Add to favorites" when not favorited', () => {
        renderItem({ favorites: new Set<string>() });
        expect(screen.getByRole('button', { name: /add to favorites/i })).toBeInTheDocument();
    });

    it('shows "Remove from favorites" when favorited', () => {
        renderItem({ favorites: new Set(['p1']) });
        expect(screen.getByRole('button', { name: /remove from favorites/i })).toBeInTheDocument();
    });

    it('calls onToggleFavorite with preset id when clicked', () => {
        const { onToggleFavorite, onClick } = renderItem();
        fireEvent.click(screen.getByRole('button', { name: /add to favorites/i }));
        expect(onToggleFavorite).toHaveBeenCalledWith('p1');
        expect(onClick).not.toHaveBeenCalled();
    });
});

describe('PresetItem — track kind icon', () => {
    it('renders MIDI track icon for midi trackKind', () => {
        renderItem({ preset: makePreset({ trackKind: 'midi' }) });
        expect(screen.getByLabelText('MIDI track')).toBeInTheDocument();
    });

    it('renders Audio track icon for audio trackKind', () => {
        renderItem({ preset: makePreset({ trackKind: 'audio' }) });
        expect(screen.getByLabelText('Audio track')).toBeInTheDocument();
    });
});

describe('PresetItem — title tooltip', () => {
    it('shows "load onto selected track" when a track is selected', () => {
        renderItem({ selectedTrackId: 'track-1' });
        expect(screen.getByText('Warm Pad').closest('[title]')).toHaveAttribute(
            'title',
            'Click to load onto selected track'
        );
    });

    it('shows "create a new track" when no track is selected', () => {
        renderItem({ selectedTrackId: null });
        expect(screen.getByText('Warm Pad').closest('[title]')).toHaveAttribute('title', 'Click to create a new track');
    });
});

describe('PresetItem — preview button', () => {
    it('calls preview.playTone with preset id when preview clicked', () => {
        const playTone = vi.fn();
        renderItem({ preview: makePreview({ playTone }) });
        fireEvent.click(screen.getByTestId('preview-btn'));
        expect(playTone).toHaveBeenCalledWith('p1', 261.63, 0.5);
    });
});

describe('PresetItem — card click', () => {
    it('calls onClick when preset name area is clicked', () => {
        const { onClick } = renderItem();
        fireEvent.click(screen.getByText('Warm Pad'));
        expect(onClick).toHaveBeenCalledTimes(1);
    });
});
