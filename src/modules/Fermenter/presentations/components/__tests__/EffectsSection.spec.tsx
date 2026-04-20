import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DEFAULT_PATCH as F } from '../../../models/FermenterPatch';
import { EffectsSection } from '../EffectsSection';

describe('EffectsSection', () => {
    it('should render', () => {
        render(
            <EffectsSection
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
            />
        );
        expect(screen.getByText(/dist/i)).toBeInTheDocument();
    });
});
