import { describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { type CommandObjectReference } from '../../models/VersionedCommandEnvelope';
import { collectCommandIdReferences } from '../collectCommandIdReferences';
import { compileCommandArgumentMetadata } from '../commandArgumentMetadata';
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
