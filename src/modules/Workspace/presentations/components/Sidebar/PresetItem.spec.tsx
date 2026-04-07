import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PresetItem } from './PresetItem';
import { type SoundPresetView } from '../../../models/SoundPresetViewTypes';

const basePreset: SoundPresetView = {
    id: 'preset-1',
    name: 'Warm Pad',
    category: 'pad',
    description: 'A pad',
    trackKind: 'midi',
    devices: [{ type: 'synth', name: 'Device A', parameterValues: {} }],
    tags: [],
    author: 'test',
    isFactory: true,
};

describe('PresetItem', () => {
    it('should render preset name and invoke onClick', () => {
        const onClick = vi.fn();
        const onToggleFavorite = vi.fn();
        const preview = {
            playingId: null as string | null,
            playTone: vi.fn(),
            stop: vi.fn(),
        };
        render(
            <PresetItem
                preset={basePreset}
                selectedTrackId="track-1"
                favorites={new Set()}
                onToggleFavorite={onToggleFavorite}
                onClick={onClick}
                preview={preview}
            />
        );
        expect(screen.getByText('Warm Pad')).toBeInTheDocument();
        fireEvent.click(screen.getByText('Warm Pad'));
        expect(onClick).toHaveBeenCalledTimes(1);
    });
});
