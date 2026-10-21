import { afterEach, describe, expect, it, vi } from 'vitest';

import { getExecutableAppActionToolSchemas, getExecutableCommandRegistrations } from '#/modules/Command/useCases';

import { type ToolSchema } from '../../models/ToolDefinitions';
import { WORKFLOW_ACTION_TOOL_NAMES } from '../../models/WorkflowCapability';
import { getAgentToolCatalogEntries } from '../getAgentToolCatalogEntries';
import { getPlanningProviderToolSchemas } from '../getPlanningProviderToolSchemas';

vi.mock('#/modules/Command/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Command/useCases')>();
    return { ...actual, getExecutableAppActionToolSchemas: vi.fn(actual.getExecutableAppActionToolSchemas) };
});

const registrySchemas = getExecutableAppActionToolSchemas();

afterEach(() => {
    vi.mocked(getExecutableAppActionToolSchemas).mockReturnValue(registrySchemas);
});

describe('provider workflow tool authority', () => {
    it('publishes every workflow tool exactly once with its visible Command descriptor schema', () => {
        const registrations = getExecutableCommandRegistrations();
        const schemas = getPlanningProviderToolSchemas();
        expect(new Set(schemas.map((schema) => schema.function.name)).size).toBe(schemas.length);

        for (const name of WORKFLOW_ACTION_TOOL_NAMES) {
            const registration = registrations.find((candidate) => candidate.actionType === name);
            expect(registration, name).toBeDefined();
            expect(registration?.discoverability, name).toBe('visible');
            const providerSchema = schemas.find((schema) => schema.function.name === name);
            expect(providerSchema?.function.parameters, name).toEqual({
                type: 'object',
                properties: registration?.providerSchema.properties,
                required: registration?.providerSchema.required,
                additionalProperties: false,
            });
            expect(providerSchema, name).toEqual(
                getAgentToolCatalogEntries({ category: 'command', names: [name] }).items[0]
            );
        }
    });

    it('never restores a command that the Command owner stops publishing', () => {
        vi.mocked(getExecutableAppActionToolSchemas).mockReturnValue(
            registrySchemas.filter((schema) => schema.function.name !== 'muteTrack')
        );
        expect(getPlanningProviderToolSchemas().map((schema) => schema.function.name)).not.toContain('muteTrack');
    });

    it('carries changed owner bounds and required fields without a parallel schema', () => {
        const schemas = registrySchemas.map((schema) => {
            if (schema.function.name !== 'setTrackPan') {
                return schema;
            }
            return {
                ...schema,
                function: {
                    ...schema.function,
                    parameters: {
                        ...schema.function.parameters,
                        properties: {
                            ...schema.function.parameters.properties,
                            pan: { type: 'number', maximum: 17 },
                        },
                        required: ['trackId' as const, 'pan' as const],
                    },
                },
            };
        });
        vi.mocked(getExecutableAppActionToolSchemas).mockReturnValue(schemas);
        expect(getPlanningProviderToolSchemas().find((schema) => schema.function.name === 'setTrackPan')).toEqual(
            schemas.find((schema) => schema.function.name === 'setTrackPan')
        );
    });
});

describe('owner-published tool contracts retained after legacy schema retirement', () => {
    function schema(name: string): ToolSchema['function'] {
        const found = registrySchemas.find((candidate) => candidate.function.name === name);
        if (found === undefined) {
            throw new Error(`No owner-published schema for ${name}.`);
        }
        return found.function;
    }

    it('publishes explicit transport state without playback, recording or punch toggles', () => {
        expect(schema('setPlayback').parameters).toMatchObject({
            properties: { playing: { type: 'boolean' } },
            required: ['playing'],
        });
        expect(schema('stopPlayback')).toBeDefined();
        expect(schema('setPunchEnabled').parameters).toMatchObject({
            type: 'object',
            properties: { enabled: { type: 'boolean' } },
            required: ['enabled'],
            additionalProperties: false,
        });
        for (const name of ['togglePlayback', 'toggleRecording', 'togglePunch']) {
            expect(registrySchemas.some((candidate) => candidate.function.name === name)).toBe(false);
        }
    });

    it('keeps automation targets open to exact device parameter IDs and lane-owned value bounds', () => {
        const lane = schema('addAutomationLane').parameters;
        expect(lane.required).toEqual(['trackId', 'parameterId']);
        expect(lane.properties.parameterId).toMatchObject({ type: 'string' });
        expect(lane.properties.parameterId).not.toHaveProperty('enum');
        expect(JSON.stringify(lane.properties.parameterId)).toContain('<deviceId>:<parameterId>');
        const point = schema('addAutomationPoint').parameters;
        expect(JSON.stringify(point.properties)).not.toMatch(/"(minimum|maximum)":/);
        expect(point.required).toEqual(['laneId', 'beat']);
        expect(point.properties).toMatchObject({
            valueDb: { type: 'number' },
            deltaDb: { type: 'number' },
            value: { type: 'number' },
            curve: { enum: ['linear', 'step', 'exponential', 's-curve', 'stairs', 'smooth', 'bezier'] },
        });
        expect(schema('setAutomationLaneEnabled').parameters.required).toEqual(['laneId', 'enabled']);
        for (const [name, required] of [
            ['setAutomationMode', ['trackId', 'mode']],
            ['scaleAutomation', ['laneId', 'factor']],
            ['stretchAutomation', ['laneId', 'factor']],
            ['invertAutomation', ['laneId']],
            ['reverseAutomation', ['laneId']],
            ['thinAutomation', ['laneId']],
            ['quantizeAutomation', ['laneId', 'gridSize']],
        ] as const) {
            expect(schema(name).parameters.required, name).toEqual(required);
        }
    });

    it('keeps sidechain endpoints owner-published and device parameters in exact native units', () => {
        for (const name of ['addSidechainRoute', 'removeSidechainRoute']) {
            const parameters = schema(name).parameters;
            const expectedPropertyNames = ['sourceTrackId', 'targetTrackId'];
            if (name === 'addSidechainRoute') {
                expectedPropertyNames.push('targetDeviceId');
            }
            expect(Object.keys(parameters.properties)).toEqual(expectedPropertyNames);
            expect(parameters.required).toEqual(['sourceTrackId', 'targetTrackId']);
            expect(parameters.additionalProperties).toBe(false);
        }
        const serialized = JSON.stringify(schema('setDeviceParameter'));
        expect(serialized).toContain('exact native unit and range');
        for (const parameterId of ['eq-mid-freq', 'comp-ratio', 'rev-mix', 'comp-threshold']) {
            expect(serialized).toContain(parameterId);
        }
        for (const inventedName of ['"frequency"', '"ratio"', '"mix"', '"threshold"']) {
            expect(serialized).not.toContain(inventedName);
        }
    });

    it('retains discoverable clip, device and marker commands while general planning excludes note generation', () => {
        for (const name of ['renameClip', 'addDevice', 'bypassDevice', 'removeDevice', 'addMarker', 'addSection']) {
            expect(schema(name).description, name).not.toBe('');
            expect(schema(name).parameters.required, name).toEqual(expect.any(Array));
        }
        expect(getPlanningProviderToolSchemas().map((candidate) => candidate.function.name)).not.toContain('addNotes');
    });
});
