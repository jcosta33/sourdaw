import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { KOKORO_VOICE_ARTIFACTS } from '../../../models/KokoroArtifactManifest';
import { KokoroVoiceSelector } from '../KokoroVoiceSelector';

describe('KokoroVoiceSelector', () => {
    it('should render every catalog voice grouped into accent/gender optgroups', () => {
        render(<KokoroVoiceSelector value="af_heart" onChange={vi.fn()} />);

        const select = screen.getByLabelText('Kokoro TTS voice');
        expect(select).toBeInstanceOf(HTMLSelectElement);
        expect(screen.getAllByRole('option')).toHaveLength(KOKORO_VOICE_ARTIFACTS.length);

        const americanFemaleGroup = screen.getByRole('group', { name: 'American English · Female' });
        expect(americanFemaleGroup).toBeInTheDocument();
        expect(screen.getByRole('group', { name: 'British English · Male' })).toBeInTheDocument();
    });

    it('should report the selected voice id on change', () => {
        const handleChange = vi.fn();
        render(<KokoroVoiceSelector value="af_heart" onChange={handleChange} />);

        fireEvent.change(screen.getByLabelText('Kokoro TTS voice'), { target: { value: 'bm_george' } });

        expect(handleChange).toHaveBeenCalledWith('bm_george');
    });

    it('should reflect the current value, disabled state, and className', () => {
        render(<KokoroVoiceSelector value="am_adam" onChange={vi.fn()} disabled className="custom-selector" />);

        const select = screen.getByLabelText('Kokoro TTS voice');
        expect(select).toHaveValue('am_adam');
        expect(select).toBeDisabled();
        expect(select).toHaveClass('custom-selector');
    });
});
