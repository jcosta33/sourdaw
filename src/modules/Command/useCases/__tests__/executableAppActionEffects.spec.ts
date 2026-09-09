import { describe, expect, it } from 'vitest';

import {
    executableAppActionEffectsByType,
    getExecutableAppActionEffect,
    type ExecutableAppActionEffect,
} from '../executableAppActionEffects';
import { executableAppActionDescriptors, isExecutableAppActionType } from '../executableAppActionRegistry';
import {
    CREATE_OPERATIONS,
    DELETE_OPERATIONS,
    MASTER_OPERATIONS,
    ROUTING_OPERATIONS,
    TEMPO_OPERATIONS,
} from '../getVersionedCommandBatchEffects';

const descriptorActionTypes = executableAppActionDescriptors.map((descriptor) => descriptor.actionType);
const executableActionTypeSet = new Set<string>(descriptorActionTypes);

function hasDuplicates(values: readonly string[]): boolean {
    return new Set(values).size !== values.length;
}

function rowFor(actionType: string): ExecutableAppActionEffect {
    if (!isExecutableAppActionType(actionType)) {
        throw new Error(`unknown executable action type: ${actionType}`);
    }
    return executableAppActionEffectsByType[actionType];
}

function onlyExecutableActionTypes(operations: ReadonlySet<string>): readonly string[] {
    return [...operations].filter((name) => executableActionTypeSet.has(name));
}

describe('executableAppActionEffectsByType', () => {
    it('S1: has exactly one row per registry descriptor action type, in both directions', () => {
        const mapKeys = Object.keys(executableAppActionEffectsByType);

        expect(new Set(mapKeys)).toEqual(new Set(descriptorActionTypes));
        expect(mapKeys.length).toBe(descriptorActionTypes.length);
    });

    it('S2: every row declares a non-empty, duplicate-free dimensions list', () => {
        for (const actionType of descriptorActionTypes) {
            const row = rowFor(actionType);

            expect(row.dimensions.length, `${actionType}: dimensions must be non-empty`).toBeGreaterThan(0);
            expect(hasDuplicates(row.dimensions), `${actionType}: dimensions must be duplicate-free`).toBe(false);
        }
    });

    it('S3: conditional dimensions never duplicate an unconditional dimension, and are duplicate-free by (dimension, when)', () => {
        for (const actionType of descriptorActionTypes) {
            const row = rowFor(actionType);
            const conditional = row.conditional ?? [];

            for (const entry of conditional) {
                expect(
                    row.dimensions.includes(entry.dimension),
                    `${actionType}: conditional dimension '${entry.dimension}' must be absent from unconditional dimensions`
                ).toBe(false);
            }

            const pairs = conditional.map((entry) => `${entry.dimension}@${entry.when}`);
            expect(hasDuplicates(pairs), `${actionType}: conditional entries must be duplicate-free`).toBe(false);
        }
    });

    it('S4: noteFields is present only alongside midi-content, and is non-empty and duplicate-free when present', () => {
        for (const actionType of descriptorActionTypes) {
            const row = rowFor(actionType);

            if (row.noteFields === undefined) {
                continue;
            }

            expect(
                row.dimensions.includes('midi-content'),
                `${actionType}: noteFields requires 'midi-content' in dimensions`
            ).toBe(true);
            expect(row.noteFields.length, `${actionType}: noteFields must be non-empty when present`).toBeGreaterThan(
                0
            );
            expect(hasDuplicates(row.noteFields), `${actionType}: noteFields must be duplicate-free`).toBe(false);
        }
    });

    it('S5: creates and removes, when present, are non-empty and duplicate-free', () => {
        for (const actionType of descriptorActionTypes) {
            const row = rowFor(actionType);

            if (row.creates !== undefined) {
                expect(row.creates.length, `${actionType}: creates must be non-empty when present`).toBeGreaterThan(0);
                expect(hasDuplicates(row.creates), `${actionType}: creates must be duplicate-free`).toBe(false);
            }

            if (row.removes !== undefined) {
                expect(row.removes.length, `${actionType}: removes must be non-empty when present`).toBeGreaterThan(0);
                expect(hasDuplicates(row.removes), `${actionType}: removes must be duplicate-free`).toBe(false);
            }
        }
    });

    it('S6: cross-checks against the exported grant sets from getVersionedCommandBatchEffects', () => {
        for (const actionType of onlyExecutableActionTypes(ROUTING_OPERATIONS)) {
            expect(rowFor(actionType).dimensions, `${actionType}: ROUTING_OPERATIONS member`).toContain('routing');
        }

        for (const actionType of onlyExecutableActionTypes(TEMPO_OPERATIONS)) {
            expect(rowFor(actionType).dimensions, `${actionType}: TEMPO_OPERATIONS member`).toContain('project-timing');
        }

        for (const actionType of onlyExecutableActionTypes(MASTER_OPERATIONS)) {
            expect(rowFor(actionType).dimensions, `${actionType}: MASTER_OPERATIONS member`).toContain('master');
        }

        for (const actionType of onlyExecutableActionTypes(CREATE_OPERATIONS)) {
            const row = rowFor(actionType);
            expect(row.creates, `${actionType}: CREATE_OPERATIONS member must declare creates`).toBeDefined();
            expect(row.creates?.length ?? 0, `${actionType}: creates must be non-empty`).toBeGreaterThan(0);
        }

        for (const actionType of onlyExecutableActionTypes(DELETE_OPERATIONS)) {
            const row = rowFor(actionType);
            expect(row.removes, `${actionType}: DELETE_OPERATIONS member must declare removes`).toBeDefined();
            expect(row.removes?.length ?? 0, `${actionType}: removes must be non-empty`).toBeGreaterThan(0);
        }
    });

    it('S7: getExecutableAppActionEffect returns the row identity for known types and null for unknown names', () => {
        expect(getExecutableAppActionEffect('setDeviceParameter')).toBe(
            executableAppActionEffectsByType.setDeviceParameter
        );
        expect(getExecutableAppActionEffect('notARealAction')).toBeNull();
    });

    it('pins the exact effect object for setDeviceParameter', () => {
        expect(executableAppActionEffectsByType.setDeviceParameter).toEqual({
            dimensions: ['processing'],
            conditional: [{ dimension: 'automation', when: 'transport-playing-in-recording-mode' }],
            scope: 'target',
        });
    });

    it('pins the exact effect object for setTrackPan', () => {
        expect(executableAppActionEffectsByType.setTrackPan).toEqual({
            dimensions: ['processing'],
            conditional: [{ dimension: 'automation', when: 'transport-playing-in-recording-mode' }],
            scope: 'target',
        });
    });

    it('pins the exact effect object for addDevice', () => {
        expect(executableAppActionEffectsByType.addDevice).toEqual({
            dimensions: ['processing'],
            conditional: [{ dimension: 'external', when: 'folder-strip-activation' }],
            scope: 'descendants',
            creates: ['device'],
        });
    });

    it('pins the exact effect object for removeClip', () => {
        expect(executableAppActionEffectsByType.removeClip).toEqual({
            dimensions: ['arrangement', 'clip-audio', 'automation'],
            conditional: [{ dimension: 'midi-content', when: 'midi-clip' }],
            scope: 'siblings',
            removes: ['clip', 'notes', 'automation-lane'],
        });
    });

    it('pins the exact effect object for setTrackOutput', () => {
        expect(executableAppActionEffectsByType.setTrackOutput).toEqual({
            dimensions: ['routing'],
            scope: 'dependents',
        });
    });

    it('pins the exact effect object for setTempo', () => {
        expect(executableAppActionEffectsByType.setTempo).toEqual({
            dimensions: ['project-timing'],
            scope: 'project',
        });
    });

    it('pins the exact effect object for quantizeNotes', () => {
        expect(executableAppActionEffectsByType.quantizeNotes).toEqual({
            dimensions: ['midi-content'],
            scope: 'target',
            noteFields: ['startBeat'],
        });
    });

    it('pins the exact effect object for arpeggiate', () => {
        expect(executableAppActionEffectsByType.arpeggiate).toEqual({
            dimensions: ['midi-content'],
            scope: 'target',
            creates: ['notes'],
            removes: ['notes'],
            noteFields: ['pitch', 'startBeat', 'duration', 'velocity'],
        });
    });

    it('pins the exact effect object for createDrumPreviewBranches', () => {
        expect(executableAppActionEffectsByType.createDrumPreviewBranches).toEqual({
            dimensions: ['branching'],
            scope: 'target',
            creates: ['branch'],
        });
    });

    it('pins the exact effect object for thinAutomation', () => {
        expect(executableAppActionEffectsByType.thinAutomation).toEqual({
            dimensions: ['automation'],
            scope: 'dependents',
            removes: ['automation-point'],
        });
    });

    it('pins the exact effect object for setPlayback', () => {
        expect(executableAppActionEffectsByType.setPlayback).toEqual({
            dimensions: ['transport'],
            conditional: [
                { dimension: 'clip-audio', when: 'recording-in-progress' },
                { dimension: 'midi-content', when: 'recording-in-progress' },
                { dimension: 'automation', when: 'transport-playing-in-recording-mode' },
            ],
            scope: 'project',
        });
    });

    it('pins the exact effect object for splitClip', () => {
        expect(executableAppActionEffectsByType.splitClip).toEqual({
            dimensions: ['arrangement', 'clip-audio', 'automation'],
            conditional: [{ dimension: 'midi-content', when: 'midi-clip' }],
            scope: 'target',
            creates: ['clip', 'notes', 'automation-lane'],
        });
    });

    it('pins the exact effect object for addTrack', () => {
        expect(executableAppActionEffectsByType.addTrack).toEqual({
            dimensions: ['arrangement'],
            conditional: [{ dimension: 'processing', when: 'midi-track-kind' }],
            scope: 'target',
            creates: ['track', 'device'],
        });
    });

    it('pins the exact effect object for assignToVca', () => {
        expect(executableAppActionEffectsByType.assignToVca).toEqual({
            dimensions: ['routing', 'processing'],
            scope: 'dependents',
        });
    });

    it('pins the exact effect object for armTrack', () => {
        expect(executableAppActionEffectsByType.armTrack).toEqual({
            dimensions: ['monitoring'],
            conditional: [{ dimension: 'routing', when: 'midi-track-kind' }],
            scope: 'project',
        });
    });
});
