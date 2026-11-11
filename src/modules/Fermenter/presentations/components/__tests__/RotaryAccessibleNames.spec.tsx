import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AdditiveSection } from '../AdditiveSection';
import { CrumbsSection } from '../CrumbsSection';
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
        render(
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
                    numLayers={2}
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
    });
});
