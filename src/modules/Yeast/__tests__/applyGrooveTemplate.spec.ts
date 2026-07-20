import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultGrooveTemplateState, grooveTemplateStore } from '#/modules/MIDI/stores';
import {
    assignGrooveTemplate,
    createGrooveTemplate,
    getScopedGrooveConsumerId,
    getStraightGrooveTemplateId,
    previewGrooveTemplate,
} from '#/modules/MIDI/useCases';

import { type MidiEvent, type TransportInfo } from '../models/MidiEvent';
import { createYeastRuntimeProjection } from '../useCases/createYeastRuntimeProjection';
import { YEAST_GROOVE_OWNER_ID } from '../useCases/getYeastGrooveAssignment';
import { GrooveModule } from '../workers/processors/GrooveModule';

import type { YeastPreviewDecisionSink } from '../workers/YeastPreviewSidecar';

const transport: TransportInfo = {
    sampleRate: 48_000,
    bpm: 120,
    ppqPosition: 0,
    isPlaying: true,
    barIndex: 0,
    beatInBar: 0,
    timeSigNum: 4,
    timeSigDen: 4,
    loopEnabled: false,
    loopStartPpq: 0,
    loopEndPpq: 0,
};

const previewSink: YeastPreviewDecisionSink = {
    recordDecision: vi.fn(() => 0),
    transferDecisionLineage: vi.fn(),
    retainDecisionLineage: vi.fn(() => 0),
    restoreDecisionLineage: vi.fn(),
    releaseDecisionLineage: vi.fn(),
};

function createProjectedGroove(templateId: string, amount: number): GrooveModule {
    assignGrooveTemplate({
        consumerType: 'yeast-processor',
        consumerId: getScopedGrooveConsumerId({ ownerId: YEAST_GROOVE_OWNER_ID, localId: 'groove-1' }),
        templateId,
        amount,
    });
    const projection = createYeastRuntimeProjection([
        { id: 'groove-1', type: 'groove', name: 'Groove', bypassed: false, params: {} },
    ]);
    const projected = projection[0];
    if (!projected) {
        throw new Error('Expected groove runtime projection');
    }
    const groove = new GrooveModule('groove-1');
    for (const [name, value] of Object.entries(projected.params)) {
        groove.setParam(name, value);
    }
    return groove;
}

describe('Yeast groove application', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        grooveTemplateStore.set(structuredClone(defaultGrooveTemplateState));
    });

    it('uses the shared template projection for identical render and preview offsets without mutating source', () => {
        createGrooveTemplate({
            id: 'shared-pocket',
            name: 'Shared pocket',
            subdivision: '1/16',
            slots: [{ index: 1, timingOffset: 0.2, dynamicsOffset: -0.1 }],
            provenance: { type: 'user', sourceId: 'test' },
        });
        const source: MidiEvent[] = [
            {
                timeSamples: 6_000,
                timePpq: 0.25,
                kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
            },
        ];
        const sourceBefore = structuredClone(source);
        const renderOutput: MidiEvent[] = [];
        const previewOutput: MidiEvent[] = [];

        createProjectedGroove('shared-pocket', 0.5).processMidi(source, renderOutput, transport);
        createProjectedGroove('shared-pocket', 0.5).processMidi(source, previewOutput, transport, previewSink);
        const sharedProjection = previewGrooveTemplate({
            events: [{ id: 'source-note', startBeat: 0.25, velocity: 100 }],
            templateId: 'shared-pocket',
            amount: 0.5,
        });

        expect(renderOutput).toEqual(previewOutput);
        expect(renderOutput[0]?.timePpq).toBe(sharedProjection[0]?.startBeat);
        const renderedKind = renderOutput[0]?.kind;
        if (renderedKind?.type !== 'noteOn') {
            throw new Error('Expected rendered note on');
        }
        expect(renderedKind.velocity).toBe(sharedProjection[0]?.velocity);
        expect(source).toEqual(sourceBefore);
    });

    it('preserves Straight as a bit-for-bit value no-op for render and preview', () => {
        const source: MidiEvent[] = [
            {
                timeSamples: 6_000,
                timePpq: 0.25,
                kind: { type: 'noteOn', channel: 0, note: 60, velocity: 100 },
            },
        ];
        const sourceBefore = structuredClone(source);
        const renderOutput: MidiEvent[] = [];
        const previewOutput: MidiEvent[] = [];

        createProjectedGroove(getStraightGrooveTemplateId(), 1).processMidi(source, renderOutput, transport);
        createProjectedGroove(getStraightGrooveTemplateId(), 1).processMidi(
            source,
            previewOutput,
            transport,
            previewSink
        );

        expect(renderOutput).toEqual(sourceBefore);
        expect(previewOutput).toEqual(sourceBefore);
        expect(source).toEqual(sourceBefore);
    });
});
