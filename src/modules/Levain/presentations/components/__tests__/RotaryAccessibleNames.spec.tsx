import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createDefaultPatch } from '../../../models/LevainPatch';
import { ExpressionPanel } from '../ExpressionPanel';
import { HumanizePanel } from '../HumanizePanel';
import { LegatoTuning } from '../LegatoTuning';
import { MicBlendSlider } from '../MicBlendSlider';

const expectSliders = (names: readonly string[]): void => {
    for (const name of names) {
        expect(screen.getByRole('slider', { name })).toBeInTheDocument();
    }
};

describe('Levain rotary accessible names', () => {
    it('names humanization and legato controls with their complete visible purpose', () => {
        const patch = createDefaultPatch('violin-1');
        render(
            <>
                <HumanizePanel config={patch.humanize} onChange={vi.fn()} />
                <LegatoTuning config={patch.legato} onChange={vi.fn()} />
            </>
        );

        expectSliders([
            'Humanize amount',
            'Humanize timing',
            'Humanize tuning',
            'Humanize dynamic',
            'Humanize vibrato variation',
            'Legato slow threshold',
            'Legato fast threshold',
            'Portamento velocity threshold',
        ]);
    });

    it('distinguishes the expression crossfade and vibrato range controls', () => {
        const patch = createDefaultPatch('violin-1');
        render(
            <ExpressionPanel
                expression={patch.expression}
                legato={patch.legato}
                onChangeExp={vi.fn()}
                onChangeLeg={vi.fn()}
            />
        );

        expectSliders([
            'Dynamic crossfade',
            'Vibrato depth',
            'Vibrato rate minimum',
            'Vibrato rate maximum',
            'Vibrato onset delay',
        ]);
    });

    it('names each microphone pan control', () => {
        const patch = createDefaultPatch('violin-1');
        render(
            <MicBlendSlider
                micPositions={patch.micPositions}
                showFull
                onSendMicParam={vi.fn()}
                onUpdateMicPosition={vi.fn()}
            />
        );

        expectSliders(['Close pan', 'Decca Tree pan', 'Room pan']);
    });

    it('names the compact close and room blend', () => {
        const patch = createDefaultPatch('violin-1');
        render(
            <MicBlendSlider micPositions={patch.micPositions} onSendMicParam={vi.fn()} onUpdateMicPosition={vi.fn()} />
        );

        expectSliders(['Close and room microphone blend']);
    });
});
