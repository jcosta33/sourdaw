import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AdditiveSection } from '../AdditiveSection';
import { CrumbsSection } from '../CrumbsSection';
import { EffectsSection } from '../EffectsSection';
import { GranularSection } from '../GranularSection';
import { KarplusSection } from '../KarplusSection';
import { LayerStack } from '../LayerStack';
import { ModulationSection } from '../ModulationSection';
import { WarpSection } from '../WarpSection';

const expectSliders = (names: readonly string[]): void => {
    for (const name of names) {
        expect(screen.getByRole('slider', { name })).toBeInTheDocument();
    }
};

describe('Fermenter rotary accessible names', () => {
    it('names synthesis, sampler, warp, and modulation controls with their visible purpose', () => {
        const onParam = vi.fn();
        render(
            <>
                <AdditiveSection partials={32} tilt={0} oddEmphasis={0} inharmonicity={0} onParam={onParam} />
                <CrumbsSection mode={0} start={0} end={1} onParam={onParam} />
                <WarpSection
                    warpMode={1}
                    warpAmount={0.5}
                    audioModRate={20}
                    audioModDepth={0.5}
                    audioModTarget={1}
                    onParam={onParam}
                />
                <ModulationSection msegToFilter={0} seqRate={4} seqToPitch={0} onParam={onParam} />
                <KarplusSection damping={0.5} brightness={0.7} onDampingChange={vi.fn()} onBrightnessChange={vi.fn()} />
            </>
        );

        expectSliders([
            'Additive partials',
            'Additive tilt',
            'Additive odd emphasis',
            'Additive inharmonicity',
            'Sampler start',
            'Sampler end',
            'Warp amount',
            'Audio-rate modulation rate',
            'Audio-rate modulation depth',
            'MSEG to filter',
            'Step sequencer rate',
            'Step sequencer to pitch',
            'String damping',
            'String brightness',
        ]);
    });

    it('names granular and active-layer controls with their device and layer context', () => {
        const { rerender } = render(
            <>
                <GranularSection
                    density={20}
                    size={50}
                    position={0}
                    spray={0.1}
                    pitchVar={0}
                    panSpread={0.5}
                    onParam={vi.fn()}
                />
                <LayerStack
                    numLayers={4}
                    activeLayer={1}
                    layerLevel={1}
                    layerPan={0}
                    currentEngine={0}
                    onActiveLayerChange={vi.fn()}
                    onNumLayersChange={vi.fn()}
                    onLevelChange={vi.fn()}
                    onPanChange={vi.fn()}
                />
            </>
        );

        expectSliders([
            'Granular density',
            'Granular size',
            'Granular position',
            'Granular spray',
            'Granular pitch variation',
            'Granular pan spread',
            'Layer 2 level',
            'Layer 2 pan',
        ]);

        rerender(
            <LayerStack
                numLayers={4}
                activeLayer={2}
                layerLevel={1}
                layerPan={0}
                currentEngine={0}
                onActiveLayerChange={vi.fn()}
                onNumLayersChange={vi.fn()}
                onLevelChange={vi.fn()}
                onPanChange={vi.fn()}
            />
        );

        expectSliders(['Layer 3 level', 'Layer 3 pan']);
        expect(screen.queryByRole('slider', { name: 'Layer 2 level' })).not.toBeInTheDocument();
        expect(screen.queryByRole('slider', { name: 'Layer 2 pan' })).not.toBeInTheDocument();
    });

    it('distinguishes every Chorus and Phaser rotary control', () => {
        render(
            <EffectsSection
                reverbType={0}
                reverbMix={0.2}
                reverbDecay={0.5}
                delayTime={0.375}
                delayFeedback={0.35}
                delayMix={0}
                chorusRate={1.2}
                chorusDepth={0.4}
                chorusMix={0}
                phaserRate={0.5}
                phaserDepth={0.5}
                phaserMix={0}
                distDrive={0}
                distTone={0.5}
                distMix={0}
                compThreshold={-20}
                compRatio={4}
                compAttack={10}
                compRelease={100}
                compMix={0}
                stereoWidth={1}
                masterGain={1}
                onParam={vi.fn()}
            />
        );
        fireEvent.click(screen.getByRole('button', { name: 'Chorus/Phaser' }));

        expectSliders(['Chorus Mix', 'Chorus Rate', 'Chorus Depth', 'Phaser Mix', 'Phaser Rate', 'Phaser Depth']);
    });
});
