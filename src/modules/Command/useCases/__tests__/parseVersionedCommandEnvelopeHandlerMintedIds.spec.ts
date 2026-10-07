import { describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { type CommandApplicationAssignedId } from '../../models/VersionedCommandEnvelope';
import { compileCommandArgumentMetadata } from '../commandArgumentMetadata';
import { createVersionedCommandEnvelope } from '../createVersionedCommandEnvelope';
import { parseVersionedCommandEnvelope } from '../parseVersionedCommandEnvelope';
import { serializeVersionedCommandEnvelope } from '../serializeVersionedCommandEnvelope';

type GlueAction = Extract<AppAction, { type: 'glueClips' }>;

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

const GLUE: GlueAction = {
    type: 'glueClips',
    payload: {
        clipIds: ['clip-a', 'clip-b'],
        targetClipId: 'clip-glued',
        expected: snapshot,
        replacement: {
            ...snapshot,
            clipAutomationLanes: [lane('auto-lane-one', 'gain'), lane('auto-lane-two', 'pan')],
        },
    },
};

const GLUE_TARGET: CommandApplicationAssignedId = { argument: 'targetClipId', value: 'clip-glued' };
const GLUE_LANE_ONE: CommandApplicationAssignedId = {
    argument: 'replacement.clipAutomationLanes[0].id',
    value: 'auto-lane-one',
};
const GLUE_LANE_TWO: CommandApplicationAssignedId = {
    argument: 'replacement.clipAutomationLanes[1].id',
    value: 'auto-lane-two',
};

function parseWithAssignedIds(action: AppAction, applicationAssignedIds: readonly CommandApplicationAssignedId[]) {
    const argumentsValue = 'payload' in action ? (action.payload as Record<string, unknown>) : {};
    const metadata = compileCommandArgumentMetadata(argumentsValue, action.type);
    const envelope = createVersionedCommandEnvelope({
        action,
        applicationAssignedIds,
        availableDeviceVersions: {},
        expectedEffect: action.type,
        normalizedProjectRevision: 'revision-1',
        objectReferences: metadata.objectReferences,
        parameterUnits: metadata.parameterUnits,
        reason: `Execute ${action.type}`,
        time: metadata.time,
    });
    return parseVersionedCommandEnvelope(serializeVersionedCommandEnvelope(envelope)).status;
}

describe('parseVersionedCommandEnvelope over ids a handler drew while compiling', () => {
    // Red when the parser requires the handler-minted ids: every envelope persisted before they
    // were recorded would stop parsing after the upgrade.
    it('parses a glueClips envelope recorded before its lane ids were named', () => {
        expect(parseWithAssignedIds(GLUE, [])).toBe('valid');
        expect(parseWithAssignedIds(GLUE, [GLUE_TARGET])).toBe('invalid');
    });

    it('parses a glueClips envelope that records every id its handler drew', () => {
        expect(parseWithAssignedIds(GLUE, [GLUE_TARGET, GLUE_LANE_ONE, GLUE_LANE_TWO])).toBe('valid');
    });

    // Red when any subset is accepted: a record naming one lane but not the other was not written
    // by either writer.
    it('refuses a glueClips envelope recording only some of its handler-minted ids', () => {
        expect(parseWithAssignedIds(GLUE, [GLUE_TARGET, GLUE_LANE_ONE])).toBe('invalid');
        expect(parseWithAssignedIds(GLUE, [GLUE_LANE_TWO])).toBe('invalid');
    });

    it('refuses a glueClips envelope whose recorded id differs from its argument or names an unknown argument', () => {
        expect(
            parseWithAssignedIds(GLUE, [GLUE_TARGET, { ...GLUE_LANE_ONE, value: 'auto-other' }, GLUE_LANE_TWO])
        ).toBe('invalid');
        expect(
            parseWithAssignedIds(GLUE, [
                GLUE_TARGET,
                GLUE_LANE_ONE,
                GLUE_LANE_TWO,
                { argument: 'replacement.clipAutomationLanes[2].id', value: 'auto-lane-three' },
            ])
        ).toBe('invalid');
    });

    // The rule-based ids keep their exact-once requirement: only handler-minted ids are optional.
    it('still requires the rule id of a command whose id is named by a rule', () => {
        const createGroup: AppAction = {
            type: 'createVcaGroup',
            payload: { name: 'Vocals', trackIds: ['track-1'], vcaGroupId: 'vca-command-1' },
        };

        expect(parseWithAssignedIds(createGroup, [{ argument: 'vcaGroupId', value: 'vca-command-1' }])).toBe('valid');
        expect(parseWithAssignedIds(createGroup, [])).toBe('invalid');
    });
});
