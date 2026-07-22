import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DEFAULT_PATCH as F } from '../../../models/FermenterPatch';
import { EffectsSection } from '../EffectsSection';

function renderSection(overrides: Partial<Parameters<typeof EffectsSection>[0]> = {}) {
    return render(
        <EffectsSection
            reverbType={F.reverbType}
            reverbMix={F.reverbMix}
            reverbDecay={F.reverbDecay}
            delayTime={F.delayTime}
            delayFeedback={F.delayFeedback}
            delayMix={F.delayMix}
            chorusRate={F.chorusRate}
            chorusDepth={F.chorusDepth}
            chorusMix={F.chorusMix}
            phaserRate={F.phaserRate}
            phaserDepth={F.phaserDepth}
            phaserMix={F.phaserMix}
            distDrive={F.distDrive}
            distTone={F.distTone}
            distMix={F.distMix}
            compThreshold={F.compThreshold}
            compRatio={F.compRatio}
            compAttack={F.compAttack}
            compRelease={F.compRelease}
            compMix={F.compMix}
            stereoWidth={F.stereoWidth}
            masterGain={F.masterGain}
            eqLowFreq={F.eqLowFreq}
            eqLowGain={F.eqLowGain}
            eqLowQ={F.eqLowQ}
            eqMidFreq={F.eqMidFreq}
            eqMidGain={F.eqMidGain}
            eqMidQ={F.eqMidQ}
            eqHighFreq={F.eqHighFreq}
            eqHighGain={F.eqHighGain}
            eqHighQ={F.eqHighQ}
            onParam={vi.fn()}
            {...overrides}
        />
    );
}

describe('EffectsSection', () => {
    it('should render', () => {
        renderSection();
        expect(screen.getByText(/dist/i)).toBeInTheDocument();
    });

    /// Regression (fermenter audit F3): the Plate/FDN highlight keyed on the
    /// literal index `i === 0`, so "Plate" was always highlighted regardless
    /// of the patch's reverbType.
    it('highlights the reverb toggle matching the reverbType prop', () => {
        renderSection({ reverbType: 1 });
        fireEvent.click(screen.getByText('Reverb'));

        const plate = screen.getByRole('button', { name: 'Plate' });
        const fdn = screen.getByRole('button', { name: 'FDN' });
        expect(fdn.className).toContain('text-white');
        expect(plate.className).not.toContain('text-white');
    });

    it('highlights Plate when reverbType is 0', () => {
        renderSection({ reverbType: 0 });
        fireEvent.click(screen.getByText('Reverb'));

        const plate = screen.getByRole('button', { name: 'Plate' });
        const fdn = screen.getByRole('button', { name: 'FDN' });
        expect(plate.className).toContain('text-white');
        expect(fdn.className).not.toContain('text-white');
    });

    it('writes reverbType when a toggle button is clicked', () => {
        const onParam = vi.fn();
        renderSection({ reverbType: 0, onParam });
        fireEvent.click(screen.getByText('Reverb'));
        fireEvent.click(screen.getByRole('button', { name: 'FDN' }));

        expect(onParam).toHaveBeenCalledWith('reverbType', 1);
    });
});
