import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import {
    DECLARATIVE_TRANSFORM_BINDING_PREFIX,
    DECLARATIVE_TRANSFORM_MAX_EMITTED_COMMANDS,
    DECLARATIVE_TRANSFORM_MAX_SELECTOR_LIMIT,
    DECLARATIVE_TRANSFORM_SCHEMA_VERSION,
    type CompiledTransformCommand,
    type DeclarativeTransformDocument,
    type TransformArgument,
    type TransformSnapshot,
    type TransformStep,
} from '../../models/DeclarativeTransform';
import { type VersionedCommandEnvelope } from '../../models/VersionedCommandEnvelope';
import { compileCommandArgumentMetadata } from '../commandArgumentMetadata';
import { commandDeviceVersionsPort } from '../commandDeviceVersionsPort';
import { commandTrackDefaultsPort } from '../commandTrackDefaultsPort';
import { compileDeclarativeTransform } from '../compileDeclarativeTransform';
import { compileVersionedCommandBatchEnvelope } from '../compileVersionedCommandBatchEnvelope';
import { createVersionedCommandEnvelope } from '../createVersionedCommandEnvelope';
import { materializeCommandApplicationIds } from '../materializeCommandApplicationIds';
import { parseVersionedCommandBatchEnvelope } from '../parseVersionedCommandBatchEnvelope';
import { serializeVersionedCommandEnvelope } from '../serializeVersionedCommandEnvelope';

const COMPILER_SOURCE_PATHS = [
    '../compileDeclarativeTransform.ts',
    '../../services/declarativeTransform/evaluateTransformExpression.ts',
    '../../services/declarativeTransform/evaluateTransformCondition.ts',
    '../../services/declarativeTransform/selectTransformItems.ts',
] as const;

function deepFreeze(value: unknown): void {
    if (value === null || typeof value !== 'object') {
        return;
    }
    for (const nested of Object.values(value as Record<string, unknown>)) {
        deepFreeze(nested);
    }
    Object.freeze(value);
}

/** Two MIDI clips on one track, one audio clip on another, at the tempo the time pins read. */
function createSnapshot(): TransformSnapshot {
    const snapshot: TransformSnapshot = {
        revision: 'revision-transform-1',
        tempo: 120,
        timeSignature: [4, 4],
        tracks: [
            {
                id: 'track-keys',
                name: 'Keys',
                contentType: 'midi',
                clips: [
                    { id: 'clip-verse', name: 'Verse', startBeat: 0, endBeat: 8 },
                    { id: 'clip-chorus', name: 'Chorus', startBeat: 8, endBeat: 16 },
                ],
            },
            {
                id: 'track-drums',
                name: 'Drums',
                contentType: 'audio',
                clips: [{ id: 'clip-loop', name: 'Loop', startBeat: 0, endBeat: 4 }],
            },
        ],
    };
    deepFreeze(snapshot);
    return snapshot;
}

const RAISE_VELOCITY_STEP: TransformStep = {
    id: 'raise-velocity',
    kind: 'emit',
    operation: 'setAllVelocities',
    arguments: {
        clipId: { itemId: 'clip' },
        velocity: {
            node: 'random',
            min: { node: 'var', name: 'floor' },
            max: { node: 'var', name: 'ceiling' },
        },
    },
};

const ADD_LEAD_TRACK_STEP: TransformStep = {
    id: 'add-lead-track',
    kind: 'emit',
    operation: 'addTrack',
    binding: 'lead',
    arguments: { name: { literal: 'Lead' }, kind: { literal: 'midi' } },
};

const LEAD_CLIP_ARGUMENTS: Readonly<Record<string, TransformArgument>> = {
    trackId: { bindingRef: 'lead' },
    name: { literal: 'Lead Take' },
    type: { literal: 'midi' },
    startBeat: { node: 'var', name: 'leadStart' },
    endBeat: {
        node: 'add',
        left: { node: 'var', name: 'leadStart' },
        right: { node: 'const', quantity: { unit: 'beats', value: 4 } },
    },
};

const ADD_LEAD_CLIP_STEP: TransformStep = {
    id: 'add-lead-clip',
    kind: 'emit',
    operation: 'addClip',
    dependsOn: ['raise-velocity'],
    arguments: LEAD_CLIP_ARGUMENTS,
};

/** The same consumer without a declared dependency, so a forward binding is the only thing wrong. */
const ADD_LEAD_CLIP_STEP_ALONE: TransformStep = {
    id: 'add-lead-clip',
    kind: 'emit',
    operation: 'addClip',
    arguments: LEAD_CLIP_ARGUMENTS,
};

function createDocument(overrides: Partial<DeclarativeTransformDocument> = {}): DeclarativeTransformDocument {
    const document: DeclarativeTransformDocument = {
        schemaVersion: DECLARATIVE_TRANSFORM_SCHEMA_VERSION,
        name: 'lift-and-lead',
        seed: 1,
        variables: {
            floor: { node: 'const', quantity: { unit: 'count', value: 70 } },
            ceiling: { node: 'const', quantity: { unit: 'count', value: 110 } },
            leadStart: { node: 'secondsToBeats', value: { node: 'const', quantity: { unit: 'seconds', value: 1 } } },
        },
        selectors: { midiClips: { target: 'clip', where: { contentType: 'midi' }, limit: 8 } },
        steps: [
            { id: 'each-midi-clip', kind: 'each', selector: 'midiClips', as: 'clip', body: [RAISE_VELOCITY_STEP] },
            ADD_LEAD_TRACK_STEP,
            ADD_LEAD_CLIP_STEP,
        ],
        assertions: [
            {
                condition: {
                    cmp: 'lt',
                    left: { node: 'var', name: 'floor' },
                    right: { node: 'var', name: 'ceiling' },
                },
                message: 'variable "floor" must stay below variable "ceiling"',
            },
        ],
        ...overrides,
    };
    deepFreeze(document);
    return document;
}

function compileOrThrow(
    document: DeclarativeTransformDocument,
    snapshot: TransformSnapshot
): readonly CompiledTransformCommand[] {
    const compilation = compileDeclarativeTransform(document, snapshot);
    if (compilation.status !== 'compiled') {
        throw new Error(`expected a compiled document, got: ${compilation.reason}`);
    }
    return compilation.commands;
}

function rejectionReason(document: DeclarativeTransformDocument, snapshot: TransformSnapshot): string {
    const compilation = compileDeclarativeTransform(document, snapshot);
    if (compilation.status !== 'rejected') {
        throw new Error(`expected a rejection, got ${String(compilation.commands.length)} commands`);
    }
    return compilation.reason;
}

function readString(values: Readonly<Record<string, unknown>>, key: string): string {
    const value = values[key];
    if (typeof value !== 'string') {
        throw new TypeError(`argument ${key} is not a string`);
    }
    return value;
}

function readNumber(values: Readonly<Record<string, unknown>>, key: string): number {
    const value = values[key];
    if (typeof value !== 'number') {
        throw new TypeError(`argument ${key} is not a number`);
    }
    return value;
}

function toAppAction(command: CompiledTransformCommand): AppAction {
    const values = command.arguments;
    if (command.operation === 'setAllVelocities') {
        return {
            type: 'setAllVelocities',
            payload: { clipId: readString(values, 'clipId'), velocity: readNumber(values, 'velocity') },
        };
    }
    if (command.operation === 'addTrack') {
        const kind = readString(values, 'kind');
        if (kind !== 'midi') {
            throw new Error(`unexpected track kind ${kind}`);
        }
        return { type: 'addTrack', payload: { name: readString(values, 'name'), kind } };
    }
    if (command.operation === 'addClip') {
        const type = readString(values, 'type');
        if (type !== 'midi') {
            throw new Error(`unexpected clip type ${type}`);
        }
        return {
            type: 'addClip',
            payload: {
                trackId: readString(values, 'trackId'),
                name: readString(values, 'name'),
                type,
                startBeat: readNumber(values, 'startBeat'),
                endBeat: readNumber(values, 'endBeat'),
            },
        };
    }
    throw new Error(`unexpected operation ${command.operation}`);
}

function payloadRecord(action: AppAction): Readonly<Record<string, unknown>> {
    const payload: unknown = action.payload;
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        throw new TypeError(`action ${action.type} carries no argument record`);
    }
    return payload as Readonly<Record<string, unknown>>;
}

/** Builds the envelope through the producer that accepts a caller reason, and threads it. */
function toEnvelope(
    command: CompiledTransformCommand,
    dependencyIds: readonly string[],
    revision: string
): VersionedCommandEnvelope {
    const materialized = materializeCommandApplicationIds(toAppAction(command));
    const argumentsValue = payloadRecord(materialized.action);
    const metadata = compileCommandArgumentMetadata(argumentsValue);
    return createVersionedCommandEnvelope({
        action: materialized.action,
        applicationAssignedIds: materialized.applicationAssignedIds,
        availableDeviceVersions: commandDeviceVersionsPort.capture({
            argumentsValue,
            operation: materialized.action.type,
        }),
        dependencyIds,
        expectedEffect: command.expectedEffect,
        normalizedProjectRevision: revision,
        objectReferences: metadata.objectReferences,
        parameterUnits: metadata.parameterUnits,
        reason: command.reason,
        time: metadata.time,
    });
}

function withoutVelocity(command: CompiledTransformCommand): CompiledTransformCommand {
    const kept = Object.entries(command.arguments).filter(([name]) => name !== 'velocity');
    return { ...command, arguments: Object.fromEntries(kept) };
}

function velocities(commands: readonly CompiledTransformCommand[]): unknown[] {
    return commands
        .filter((command) => command.operation === 'setAllVelocities')
        .map((command) => command.arguments.velocity);
}

describe('declarative transform sandbox', () => {
    beforeEach(() => {
        commandTrackDefaultsPort.setTrackColorProvider(() => 'oklch(0.40 0.08 250)');
    });

    afterEach(() => {
        commandTrackDefaultsPort.setTrackColorProvider(null);
    });

    it('compiles the same document and snapshot into deep-equal commands, and a changed seed moves only the random argument', () => {
        const snapshot = createSnapshot();

        const first = compileOrThrow(createDocument(), snapshot);
        const repeated = compileOrThrow(createDocument(), snapshot);
        const reseeded = compileOrThrow(createDocument({ seed: 2 }), snapshot);

        expect(repeated).toEqual(first);
        expect(first).toHaveLength(4);
        expect(reseeded.map(withoutVelocity)).toEqual(first.map(withoutVelocity));
        expect(velocities(reseeded)).not.toEqual(velocities(first));
    });

    it('reads a frozen snapshot and document without throwing, mutating them, or naming an ambient source of change', () => {
        const snapshot = createSnapshot();
        const document = createDocument();
        const snapshotBefore = structuredClone(snapshot);
        const documentBefore = structuredClone(document);

        expect(() => compileDeclarativeTransform(document, snapshot)).not.toThrow();

        expect(snapshot).toEqual(snapshotBefore);
        expect(document).toEqual(documentBefore);
        for (const relativePath of COMPILER_SOURCE_PATHS) {
            const source = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
            expect(source).not.toContain('Math.random');
            expect(source).not.toContain('Date.now');
            expect(source).not.toContain("from '../stores");
            expect(source).not.toContain("from '../../stores");
        }
    });

    it('serializes its emitted commands into a batch envelope that parses valid with the lead binding', () => {
        const snapshot = createSnapshot();
        const commands = compileOrThrow(createDocument(), snapshot);

        const commandIdByKey = new Map<string, string>();
        const serialized = commands.map((command) => {
            const dependencyIds = command.dependencyKeys.map((key) => {
                const commandId = commandIdByKey.get(key);
                if (commandId === undefined) {
                    throw new Error(`no compiled command carries key ${key}`);
                }
                return commandId;
            });
            const envelope = toEnvelope(command, dependencyIds, snapshot.revision);
            commandIdByKey.set(command.key, envelope.commandId);
            return { command, envelope };
        });
        const producer = serialized.find((entry) => entry.command.binding === 'lead');
        expect(producer?.envelope.applicationAssignedIds.map((assigned) => assigned.argument)).toContain('id');

        const batch = compileVersionedCommandBatchEnvelope({
            runId: 'run-transform-1',
            batchId: 'batch-transform-1',
            projectId: 'project-transform-1',
            baseRevision: snapshot.revision,
            intent: 'Lift MIDI clip velocities and add a lead take',
            commands: serialized.map((entry) => serializeVersionedCommandEnvelope(entry.envelope)),
            batchLocalBindings: [
                {
                    bindingId: '$lead',
                    producerArgument: 'id',
                    producerCommandId: producer?.envelope.commandId ?? '',
                },
            ],
        });
        const parsed = parseVersionedCommandBatchEnvelope(batch.serialized, batch.authority);

        expect(parsed.status).toBe('valid');
        if (parsed.status !== 'valid') {
            throw new Error(parsed.reason);
        }
        expect(parsed.envelope.batchLocalBindings).toEqual([
            { bindingId: '$lead', producerArgument: 'id', producerCommandId: producer?.envelope.commandId },
        ]);
        const parsedClip = parsed.envelope.commands.find((command) => command.operation === 'addClip');
        expect(parsedClip?.arguments.trackId).toBe('$lead');

        const velocityCommandIds = serialized
            .filter((entry) => entry.command.operation === 'setAllVelocities')
            .map((entry) => entry.envelope.commandId);
        expect(velocityCommandIds).toHaveLength(2);
        expect(parsedClip?.dependencyIds).toEqual([...velocityCommandIds, producer?.envelope.commandId ?? '']);
        expect(parsedClip?.reason).toBe('Declarative transform "lift-and-lead" step "add-lead-clip".');
    });

    it('refuses a selector limit above the iteration bound and keeps a declared limit exact', () => {
        const snapshot = createSnapshot();

        expect(
            rejectionReason(
                createDocument({
                    selectors: {
                        midiClips: {
                            target: 'clip',
                            where: { contentType: 'midi' },
                            limit: DECLARATIVE_TRANSFORM_MAX_SELECTOR_LIMIT + 1,
                        },
                    },
                }),
                snapshot
            )
        ).toContain('iteration bound');

        const bounded = compileOrThrow(
            createDocument({
                selectors: { midiClips: { target: 'clip', where: { contentType: 'midi' }, limit: 1 } },
            }),
            snapshot
        );

        expect(bounded.filter((command) => command.operation === 'setAllVelocities')).toHaveLength(1);
    });

    it('refuses a step naming a selector the document does not declare', () => {
        const reason = rejectionReason(
            createDocument({
                steps: [
                    {
                        id: 'each-midi-clip',
                        kind: 'each',
                        selector: 'audioClips',
                        as: 'clip',
                        body: [RAISE_VELOCITY_STEP],
                    },
                ],
            }),
            createSnapshot()
        );

        expect(reason).toContain('step "each-midi-clip"');
        expect(reason).toContain('unknown selector "audioClips"');
    });

    it('refuses adding beats to seconds and converts one second into two beats at 120 bpm', () => {
        const snapshot = createSnapshot();

        expect(
            rejectionReason(
                createDocument({
                    variables: {
                        drift: {
                            node: 'add',
                            left: { node: 'const', quantity: { unit: 'beats', value: 1 } },
                            right: { node: 'const', quantity: { unit: 'seconds', value: 1 } },
                        },
                    },
                    steps: [],
                    assertions: [],
                }),
                snapshot
            )
        ).toBe('unit mismatch: beats + seconds in variable "drift"');

        const commands = compileOrThrow(createDocument(), snapshot);

        expect(commands.find((command) => command.operation === 'addClip')?.arguments).toMatchObject({
            startBeat: 2,
            endBeat: 6,
        });
    });

    it('converts between seconds and beats at the snapshot tempo, not a fixed one', () => {
        const snapshot: TransformSnapshot = { ...createSnapshot(), tempo: 90 };
        deepFreeze(snapshot);

        const commands = compileOrThrow(
            createDocument({
                variables: {
                    leadStart: {
                        node: 'secondsToBeats',
                        value: { node: 'const', quantity: { unit: 'seconds', value: 1 } },
                    },
                    backoff: {
                        node: 'beatsToSeconds',
                        value: { node: 'const', quantity: { unit: 'beats', value: 3 } },
                    },
                },
                steps: [
                    {
                        id: 'probe-lead-start',
                        kind: 'emit',
                        operation: 'setAllVelocities',
                        arguments: { clipId: { literal: 'clip-verse' }, velocity: { node: 'var', name: 'leadStart' } },
                    },
                    {
                        id: 'probe-backoff',
                        kind: 'emit',
                        operation: 'setAllVelocities',
                        arguments: { clipId: { literal: 'clip-verse' }, velocity: { node: 'var', name: 'backoff' } },
                    },
                ],
                assertions: [],
            }),
            snapshot
        );

        expect(commands.map((command) => command.arguments.velocity)).toEqual([1.5, 2]);
    });

    it('refuses an unregistered operation, a binding on a command that mints no identity, and a forward binding reference', () => {
        const snapshot = createSnapshot();

        expect(
            rejectionReason(
                createDocument({
                    steps: [{ id: 'unknown-step', kind: 'emit', operation: 'summonReverb', arguments: {} }],
                }),
                snapshot
            )
        ).toBe('step "unknown-step" names unknown operation "summonReverb"');

        expect(
            rejectionReason(
                createDocument({
                    steps: [
                        {
                            id: 'gain-step',
                            kind: 'emit',
                            operation: 'setTrackGain',
                            binding: 'lead',
                            arguments: {
                                trackId: { literal: 'track-keys' },
                                gain: { literal: 0.5 },
                                expectedGain: { literal: 1 },
                            },
                        },
                    ],
                }),
                snapshot
            )
        ).toContain('setTrackGain is not a batch-local binding producer');

        expect(
            rejectionReason(createDocument({ steps: [ADD_LEAD_CLIP_STEP_ALONE, ADD_LEAD_TRACK_STEP] }), snapshot)
        ).toContain('reads binding "lead" before the step that produces it');
    });

    it('refuses a literal wearing the binding placeholder prefix, which batch resolution would rewrite', () => {
        const reason = rejectionReason(
            createDocument({
                steps: [
                    {
                        id: 'gain-step',
                        kind: 'emit',
                        operation: 'setTrackGain',
                        arguments: {
                            trackId: { literal: `${DECLARATIVE_TRANSFORM_BINDING_PREFIX}lead` },
                            gain: { literal: 0.5 },
                            expectedGain: { literal: 1 },
                        },
                    },
                ],
            }),
            createSnapshot()
        );

        expect(reason).toBe(
            'literal "$lead" in step "gain-step" argument "trackId" collides with the binding placeholder prefix'
        );
    });

    it('refuses a document whose assertion is false, with the assertion message', () => {
        const reason = rejectionReason(
            createDocument({
                assertions: [
                    {
                        condition: {
                            cmp: 'gt',
                            left: { node: 'var', name: 'floor' },
                            right: { node: 'var', name: 'ceiling' },
                        },
                        message: 'variable "floor" must stay above variable "ceiling"',
                    },
                ],
            }),
            createSnapshot()
        );

        expect(reason).toBe('variable "floor" must stay above variable "ceiling"');
    });

    it('emits nothing from a when body whose condition is false', () => {
        const snapshot = createSnapshot();

        const commands = compileOrThrow(
            createDocument({
                steps: [
                    {
                        id: 'when-loud',
                        kind: 'when',
                        condition: {
                            cmp: 'gt',
                            left: { node: 'var', name: 'floor' },
                            right: { node: 'var', name: 'ceiling' },
                        },
                        then: [
                            {
                                id: 'each-midi-clip',
                                kind: 'each',
                                selector: 'midiClips',
                                as: 'clip',
                                body: [RAISE_VELOCITY_STEP],
                            },
                        ],
                    },
                ],
            }),
            snapshot
        );

        expect(commands).toEqual([]);
    });

    it('compiles exactly the emitted command bound and refuses the next command', () => {
        // One clip per selected item, two emits per item: the walk lands on the bound exactly.
        const clipCount = DECLARATIVE_TRANSFORM_MAX_EMITTED_COMMANDS / 2;
        expect(clipCount).toBeLessThanOrEqual(DECLARATIVE_TRANSFORM_MAX_SELECTOR_LIMIT);
        const wideSnapshot: TransformSnapshot = {
            revision: 'revision-transform-wide',
            tempo: 120,
            timeSignature: [4, 4],
            tracks: [
                {
                    id: 'track-keys',
                    name: 'Keys',
                    contentType: 'midi',
                    clips: Array.from({ length: clipCount }, (_unused, index) => ({
                        id: `clip-${String(index)}`,
                        name: `Take ${String(index)}`,
                        startBeat: index * 4,
                        endBeat: index * 4 + 4,
                    })),
                },
            ],
        };
        deepFreeze(wideSnapshot);

        const eachClipTwice: TransformStep = {
            id: 'each-midi-clip',
            kind: 'each',
            selector: 'midiClips',
            as: 'clip',
            body: [RAISE_VELOCITY_STEP, { ...RAISE_VELOCITY_STEP, id: 'raise-velocity-again' }],
        };
        const atBound = createDocument({
            selectors: { midiClips: { target: 'clip', where: { contentType: 'midi' }, limit: clipCount } },
            steps: [eachClipTwice],
            assertions: [],
        });

        expect(compileOrThrow(atBound, wideSnapshot)).toHaveLength(DECLARATIVE_TRANSFORM_MAX_EMITTED_COMMANDS);

        const reason = rejectionReason(
            createDocument({
                selectors: { midiClips: { target: 'clip', where: { contentType: 'midi' }, limit: clipCount } },
                steps: [
                    eachClipTwice,
                    {
                        id: 'one-too-many',
                        kind: 'emit',
                        operation: 'setAllVelocities',
                        arguments: {
                            clipId: { literal: 'clip-0' },
                            velocity: { node: 'const', quantity: { unit: 'count', value: 80 } },
                        },
                    },
                ],
                assertions: [],
            }),
            wideSnapshot
        );

        expect(reason).toContain('emitted command bound');
        expect(reason).toContain('step "one-too-many"');
        expect(reason).toContain(String(DECLARATIVE_TRANSFORM_MAX_EMITTED_COMMANDS));
    });

    it('keys every emission of a repeated step and depends on all of them in walk order', () => {
        const commands = compileOrThrow(createDocument(), createSnapshot());

        expect(commands.map((command) => command.key)).toEqual([
            'raise-velocity@0',
            'raise-velocity@1',
            'add-lead-track',
            'add-lead-clip',
        ]);
        expect(commands.map((command) => command.stepId)).toEqual([
            'raise-velocity',
            'raise-velocity',
            'add-lead-track',
            'add-lead-clip',
        ]);
        expect(commands.at(-1)?.dependencyKeys).toEqual(['raise-velocity@0', 'raise-velocity@1', 'add-lead-track']);
    });

    it('joins nested iteration indices in a key with the path separator', () => {
        const commands = compileOrThrow(
            createDocument({
                selectors: {
                    midiClips: { target: 'clip', where: { contentType: 'midi' }, limit: 2 },
                    midiTracks: { target: 'track', where: { contentType: 'midi' }, limit: 2 },
                },
                steps: [
                    {
                        id: 'each-track',
                        kind: 'each',
                        selector: 'midiTracks',
                        as: 'track',
                        body: [
                            {
                                id: 'each-midi-clip',
                                kind: 'each',
                                selector: 'midiClips',
                                as: 'clip',
                                body: [RAISE_VELOCITY_STEP],
                            },
                        ],
                    },
                ],
                assertions: [],
            }),
            createSnapshot()
        );

        expect(commands.map((command) => command.key)).toEqual(['raise-velocity@0/0', 'raise-velocity@0/1']);
    });
});
