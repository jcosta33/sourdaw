import { describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { type CommandObjectReference } from '../../models/VersionedCommandEnvelope';
import { collectCommandIdReferences } from '../collectCommandIdReferences';
import { compileCommandArgumentMetadata, isDerivedSourceSupportPath } from '../commandArgumentMetadata';
import { createVersionedCommandEnvelope } from '../createVersionedCommandEnvelope';
import { parseVersionedCommandEnvelope } from '../parseVersionedCommandEnvelope';
import { serializeVersionedCommandEnvelope } from '../serializeVersionedCommandEnvelope';

function lane(id: string, parameterId: string) {
    return {
        id,
        trackId: 'track-midi',
        clipId: 'clip-glued',
        parameterId,
        parameterName: parameterId,
        points: [],
        objects: [],
        visible: true,
        enabled: true,
        collapsed: false,
        minValue: 0,
        maxValue: 1,
    };
}

const snapshot = {
    trackId: 'track-midi',
    clips: [],
    clipOrder: [],
    midi: { clips: [], migratedAbsoluteNoteClipIds: { present: false, value: [] } },
    clipSatellites: [],
    clipAutomationLanes: [],
};

const GLUE = {
    type: 'glueClips',
    payload: {
        clipIds: ['clip-a', 'clip-b'],
        targetClipId: 'clip-glued',
        expected: snapshot,
        replacement: {
            ...snapshot,
            clipAutomationLanes: [lane('auto-lane-gain', 'gain'), lane('auto-lane-pan', 'pan')],
        },
    },
} satisfies AppAction;

function parseWithReferences(objectReferences: readonly CommandObjectReference[]) {
    const metadata = compileCommandArgumentMetadata(GLUE.payload, GLUE.type);
    const envelope = createVersionedCommandEnvelope({
        action: GLUE,
        applicationAssignedIds: [],
        availableDeviceVersions: {},
        expectedEffect: 'Glue two clips.',
        normalizedProjectRevision: 'revision-1',
        objectReferences,
        parameterUnits: metadata.parameterUnits,
        reason: 'Execute glueClips',
        time: metadata.time,
    });
    return parseVersionedCommandEnvelope(serializeVersionedCommandEnvelope(envelope)).status;
}

describe('compileCommandArgumentMetadata object references', () => {
    it.each(['setTempo', 'restoreTempoEdit', 'editTempoMap', 'restoreTempoMapEdit'])(
        'omits only derived tempo source metadata for %s',
        (operation) => {
            const payload = {
                bpm: 240,
                audioSourcePromotion: {
                    clips: [
                        {
                            trackId: 'audio',
                            clipId: 'source',
                            inputs: { audioBufferId: 'bursts', startBeat: 0, endBeat: 12 },
                            after: { audioOffsetSeconds: 4 },
                        },
                    ],
                },
                audioSourcePromotionExtra: { clipId: 'sibling', startBeat: 2 },
                other: { audioSourcePromotion: { clipId: 'nested', startBeat: 3 } },
                clipId: 'requested',
            };
            const metadata = compileCommandArgumentMetadata(payload, operation);
            expect(metadata.objectReferences).toEqual([
                { argument: 'audioSourcePromotionExtra.clipId', id: 'sibling', scope: 'stable' },
                { argument: 'other.audioSourcePromotion.clipId', id: 'nested', scope: 'stable' },
                { argument: 'clipId', id: 'requested', scope: 'stable' },
            ]);
            expect(metadata.time.map((time) => time.argument)).toEqual([
                'audioSourcePromotionExtra.startBeat',
                'other.audioSourcePromotion.startBeat',
            ]);
            expect(metadata.parameterUnits.map((parameter) => parameter.argument)).toEqual([
                'bpm',
                'audioSourcePromotionExtra.startBeat',
                'other.audioSourcePromotion.startBeat',
            ]);
            expect(collectCommandIdReferences(payload).map((reference) => reference.id)).toContain('bursts');
            for (const other of [undefined, 'setCompRegion', 'addClip', 'unknown-operation']) {
                expect(
                    compileCommandArgumentMetadata(payload, other).objectReferences.map((reference) => reference.id)
                ).toContain('bursts');
            }
            expect(isDerivedSourceSupportPath(operation, 'audioSourcePromotion')).toBe(true);
            for (const path of [
                'audioSourcePromotions',
                'audioSourcePromotionExtra',
                'other.audioSourcePromotion',
                'audioSourcePromotion[0]',
            ]) {
                expect(isDerivedSourceSupportPath(operation, path)).toBe(false);
            }
        }
    );

    it.each(['editTempoMap', 'restoreTempoMapEdit'])('omits only captured row-plan support for %s', (operation) => {
        const payload = {
            rowPlan: { before: [{ id: 'old', beat: 0, tempo: 120 }], after: [{ id: 'new', beat: 4, tempo: 240 }] },
            edit: { type: 'update', id: 'head', tempo: 240 },
            rowPlanExtra: { id: 'real', beat: 8 },
            other: { rowPlan: { id: 'nested', beat: 12 } },
        };
        const metadata = compileCommandArgumentMetadata(payload, operation);
        expect(metadata.objectReferences.map((reference) => reference.id)).toEqual(['head', 'real', 'nested']);
        expect(metadata.parameterUnits.map((parameter) => parameter.argument)).toEqual([
            'edit.tempo',
            'rowPlanExtra.beat',
            'other.rowPlan.beat',
        ]);
        expect(collectCommandIdReferences(payload).map((reference) => reference.id)).toContain('old');
        expect(
            compileCommandArgumentMetadata(payload, 'setTempo').objectReferences.map((reference) => reference.id)
        ).toContain('old');
    });

    // Red when a parameter id is read as an object: the batch preflight then requires a project
    // object called `gain`, which no project holds.
    it('reads no object under a nested parameterId while its sibling id and clipId stay references', () => {
        const { objectReferences } = compileCommandArgumentMetadata({
            replacement: { clipAutomationLanes: [{ id: 'lane-gain', clipId: 'clip-glued', parameterId: 'gain' }] },
        });

        expect(objectReferences).toEqual([
            { argument: 'replacement.clipAutomationLanes[0].id', id: 'lane-gain', scope: 'stable' },
            { argument: 'replacement.clipAutomationLanes[0].clipId', id: 'clip-glued', scope: 'stable' },
        ]);
    });

    it.each(['setCompRegion', 'removeCompRegion', 'restoreCompRegionInterval'])(
        'keeps %s source-support captures out of semantic scope without erasing its requested interval',
        (operation) => {
            const payload = {
                trackId: 'track-a',
                startBeat: 2,
                endBeat: 4,
                expected: [
                    {
                        startBeat: 2,
                        endBeat: 4,
                        takeId: 'take-a',
                        audioSource: { startBeat: 0, audioOffsetSeconds: 9 },
                    },
                ],
                audioSourcePromotions: [
                    {
                        expected: { clipId: 'source', startBeat: 0, endBeat: 8 },
                        sourceInputs: { clipId: 'source', startBeat: 0, endBeat: 8 },
                    },
                ],
            };
            const metadata = compileCommandArgumentMetadata(payload, operation);
            expect(metadata.objectReferences).not.toEqual(
                expect.arrayContaining([expect.objectContaining({ id: 'source' })])
            );
            expect(metadata.time.map((time) => time.value)).toEqual([2, 4, 2, 4]);
            const ordinary = compileCommandArgumentMetadata(payload, 'glueClips');
            expect(ordinary.objectReferences).toEqual(
                expect.arrayContaining([expect.objectContaining({ id: 'source' })])
            );
            expect(ordinary.time.map((time) => time.value)).toContain(8);
        }
    );

    // setDeviceParameter declares paramId a device-parameter target, so the preflight still checks
    // the parameter exists before the batch runs.
    it('keeps a setDeviceParameter paramId as a reference', () => {
        const { objectReferences } = compileCommandArgumentMetadata(
            { deviceId: 'device-filter', paramId: 'filter-type', value: 1 },
            'setDeviceParameter'
        );

        expect(objectReferences).toEqual([
            { argument: 'deviceId', id: 'device-filter', scope: 'stable' },
            { argument: 'paramId', id: 'filter-type', scope: 'stable' },
        ]);
    });
});

describe('parseVersionedCommandEnvelope over recorded object references', () => {
    it('parses an envelope recording the current references', () => {
        expect(parseWithReferences(compileCommandArgumentMetadata(GLUE.payload, GLUE.type).objectReferences)).toBe(
            'valid'
        );
    });

    // Red when only the current form parses: a pending approval or recovery continuation persisted
    // before parameter ids stopped counting as objects would be refused after the upgrade.
    it('parses an envelope persisted with its parameter ids recorded as references', () => {
        const persisted = collectCommandIdReferences(GLUE.payload);
        expect(persisted.map(({ id }) => id)).toContain('gain');

        expect(parseWithReferences(persisted)).toBe('valid');
    });

    it('refuses references that are neither the current nor the persisted form', () => {
        const persisted = collectCommandIdReferences(GLUE.payload);

        expect(parseWithReferences(persisted.filter(({ id }) => id !== 'pan'))).toBe('invalid');
        expect(parseWithReferences(persisted.filter(({ id }) => id !== 'clip-a'))).toBe('invalid');
    });
});
