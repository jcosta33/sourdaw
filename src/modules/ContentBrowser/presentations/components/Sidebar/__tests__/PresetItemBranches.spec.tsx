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
    it('shows "Add Warm Pad to favorites" when not favorited', () => {
        renderItem({ favorites: new Set<string>() });
        expect(screen.getByRole('button', { name: 'Add Warm Pad to favorites' })).toBeInTheDocument();
    });

    it('shows "Remove Warm Pad from favorites" when favorited', () => {
        renderItem({ favorites: new Set(['p1']) });
        expect(screen.getByRole('button', { name: 'Remove Warm Pad from favorites' })).toBeInTheDocument();
    });

    it('calls onToggleFavorite with preset id when clicked', () => {
        const { onToggleFavorite, onClick } = renderItem();
        fireEvent.click(screen.getByRole('button', { name: 'Add Warm Pad to favorites' }));
        expect(onToggleFavorite).toHaveBeenCalledWith('p1');
        expect(onClick).not.toHaveBeenCalled();
    });
});

describe('PresetItem — per-row names', () => {
    it('names each row preview and favorite button after its own preset', () => {
        render(
            <>
                <PresetItem
                    preset={makePreset({ id: 'p1', name: 'Warm Pad' })}
                    selectedTrackId={null}
                    favorites={new Set<string>()}
                    onToggleFavorite={vi.fn()}
                    onClick={vi.fn()}
                    preview={makePreview()}
                />
                <PresetItem
                    preset={makePreset({ id: 'p2', name: 'Bright Lead' })}
                    selectedTrackId={null}
                    favorites={new Set(['p2'])}
                    onToggleFavorite={vi.fn()}
                    onClick={vi.fn()}
                    preview={makePreview()}
                />
            </>
        );
        expect(screen.getByRole('button', { name: 'Add Warm Pad to favorites' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Remove Bright Lead from favorites' })).toBeInTheDocument();
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

/**
 * The parts of a button's description, in order. A browser reads a referenced
 * element's aria-label, which jsdom's accessible-description computation does
 * not, so each referenced element's label or text is resolved here.
 */
function describedBy(button: HTMLElement): string[] {
    return (button.getAttribute('aria-describedby') ?? '')
        .split(' ')
        .map((id) => document.getElementById(id))
        .map((part) => part?.getAttribute('aria-label') ?? part?.textContent ?? '');
}

describe('PresetItem — keyboard reachability', () => {
    it('exposes the card action as a focusable native button named for the preset', () => {
        const { onClick } = renderItem();
        const card = screen.getByRole('button', { name: 'Warm Pad' });
        expect(describedBy(card)).toEqual(['synth', 'MIDI track', 'Fermenter → Gluten']);
        expect(card.tagName).toBe('BUTTON');
        expect(card).toHaveAttribute('type', 'button');
        expect(card.tabIndex).toBeGreaterThanOrEqual(0);
        card.focus();
        expect(card).toHaveFocus();
        // jsdom does not turn Enter or Space into a click; a native button does in the browser.
        card.click();
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('describes an audio preset without a category badge by its track kind and chain', () => {
        renderItem({ preset: makePreset({ trackKind: 'audio' }), hideCategory: true });
        expect(describedBy(screen.getByRole('button', { name: 'Warm Pad' }))).toEqual([
            'Audio track',
            'Fermenter → Gluten',
        ]);
    });

    it('keeps preview, card and favorite as separate sibling buttons, none nested', () => {
        renderItem();
        const buttons = screen.getAllByRole('button');
        expect(buttons.map((button) => button.getAttribute('aria-label') ?? button.textContent?.trim())).toEqual([
            'Preview',
            'Warm Pad',
            'Add Warm Pad to favorites',
        ]);
        for (const button of buttons) {
            expect(button.querySelector('button')).toBeNull();
        }
    });

    it('does not load the preset when the favorite star is activated', () => {
        const { onClick, onToggleFavorite } = renderItem();
        const star = screen.getByRole('button', { name: 'Add Warm Pad to favorites' });
        star.focus();
        expect(star).toHaveFocus();
        star.click();
        expect(onToggleFavorite).toHaveBeenCalledWith('p1');
        expect(onClick).not.toHaveBeenCalled();
    });
});
