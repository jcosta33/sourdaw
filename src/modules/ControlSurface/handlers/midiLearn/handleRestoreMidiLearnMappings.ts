import { logger } from '#/infra/logger/appLogger';
import { createHandler } from '#/utils/createHandler';
import { type AppAction, type MidiLearnMappingsActionSnapshot } from '#/utils/handlerContract';

import {
    midiLearnStore,
    type MidiLearnState,
    type MidiMapping,
    type MidiMappingScaleMode,
} from '../../stores/midiLearnStore';

type MidiLearnMutationAction = Extract<AppAction, { type: 'completeMidiLearn' | 'removeMidiMapping' }>;

function snapshotMappings(mappings: readonly MidiMapping[]): MidiLearnMappingsActionSnapshot {
    return { mappings: mappings.map((mapping) => ({ ...mapping })) };
}

function cloneSnapshotMappings(snapshot: MidiLearnMappingsActionSnapshot): MidiMapping[] {
    return snapshot.mappings.map((mapping) => ({ ...mapping }));
}

/**
 * Per-target value contract for MIDI Learn. Ranges mirror the real param
 * contracts each target writes to:
 *  - `trackGain`  → `setTrackGain` clamps [0, 1] (linear amplitude), but a
 *    knob/fader feels right with a perceptual `log` taper, so that is the default.
 *  - `trackPan`   → `setTrackPan` clamps [-50, 50] (linear, symmetric).
 *  - `deviceParam` / `fermenterGlobalParam` → normalised [0, 1], linear.
 */
const RANGE_BY_TARGET_TYPE: Record<
    'trackGain' | 'trackPan' | 'deviceParam' | 'fermenterGlobalParam',
    { min: number; max: number; scaleMode: MidiMappingScaleMode }
> = {
    trackGain: { min: 0, max: 1, scaleMode: 'log' },
    trackPan: { min: -50, max: 50, scaleMode: 'linear' },
    deviceParam: { min: 0, max: 1, scaleMode: 'linear' },
    fermenterGlobalParam: { min: 0, max: 1, scaleMode: 'linear' },
};

/**
 * Project the mapping table forward for a MIDI Learn mutation, without
 * touching the store. Shared between `describe()` (which snapshots the
 * post-mutation state as the undo entry's conflict-check `expected`) and
 * `execute()` (which performs the real write) so the two can never drift.
 *
 * `completeMidiLearn`'s new mapping id is decided by the dispatcher and
 * carried in the action payload (`payload.mappingId`) rather than generated
 * here — `describe()` runs before `execute()` on the same action instance
 * (`executeAppAction.ts`), so a random id minted inside this projection would
 * produce a different value on each call and the conflict check would never
 * match.
 */
function projectMappings(state: MidiLearnState, action: MidiLearnMutationAction): MidiMapping[] {
    if (action.type === 'completeMidiLearn') {
        if (!state.isLearning || !state.learningTarget) {
            return state.mappings;
        }

        const target = state.learningTarget;
        const defaults = RANGE_BY_TARGET_TYPE[target.targetType];
        const mapping: MidiMapping = {
            id: action.payload.mappingId,
            channel: action.payload.channel,
            cc: action.payload.cc,
            targetType: target.targetType,
            trackId: target.trackId,
            deviceId: target.deviceId,
            paramId: target.paramId,
            minValue: defaults.min,
            maxValue: defaults.max,
            scaleMode: defaults.scaleMode,
        };

        const existingIndex = state.mappings.findIndex(
            (candidate) => candidate.channel === action.payload.channel && candidate.cc === action.payload.cc
        );
        const mappings = [...state.mappings];
        if (existingIndex >= 0) {
            mappings[existingIndex] = mapping;
        } else {
            mappings.push(mapping);
        }
        return mappings;
    }

    return state.mappings.filter((mapping) => mapping.id !== action.payload.mappingId);
}

export const handleCompleteMidiLearn = createHandler<'completeMidiLearn'>({
    execute: (action) => {
        const state = midiLearnStore.value;
        if (!state || !state.isLearning || !state.learningTarget) {
            return { status: 'no-write' };
        }

        logger.info(
            `MIDI Learn complete: CC ${String(action.payload.cc)} ch ${String(action.payload.channel)} → ${state.learningTarget.targetType}`
        );

        midiLearnStore.set({
            ...state,
            mappings: projectMappings(state, action),
            isLearning: false,
            learningTarget: null,
        });
        return { status: 'written' };
    },
    describe: (action) => {
        const state = midiLearnStore.value;
        if (!state) {
            return { label: 'Learn MIDI mapping' };
        }
        return {
            label: `Learn MIDI mapping (CC ${String(action.payload.cc)} ch ${String(action.payload.channel)})`,
            inverseAction: {
                type: 'restoreMidiLearnMappings',
                payload: {
                    expected: snapshotMappings(projectMappings(state, action)),
                    replacement: snapshotMappings(state.mappings),
                },
            },
        };
    },
    isNoop: () => {
        const state = midiLearnStore.value;
        return !state || !state.isLearning || !state.learningTarget;
    },
    undoable: true,
});

export const handleRemoveMidiMapping = createHandler<'removeMidiMapping'>({
    execute: (action) => {
        const state = midiLearnStore.value;
        if (!state) {
            return { status: 'no-write' };
        }
        const mappings = projectMappings(state, action);
        if (mappings.length === state.mappings.length) {
            return { status: 'no-write' };
        }

        logger.info(`MIDI Learn: removed mapping ${action.payload.mappingId}`);

        midiLearnStore.set({ ...state, mappings });
        return { status: 'written' };
    },
    describe: (action) => {
        const state = midiLearnStore.value;
        if (!state) {
            return { label: 'Remove MIDI mapping' };
        }
        return {
            label: 'Remove MIDI mapping',
            inverseAction: {
                type: 'restoreMidiLearnMappings',
                payload: {
                    expected: snapshotMappings(projectMappings(state, action)),
                    replacement: snapshotMappings(state.mappings),
                },
            },
        };
    },
    isNoop: (action) => {
        const state = midiLearnStore.value;
        return !state || !state.mappings.some((mapping) => mapping.id === action.payload.mappingId);
    },
    undoable: true,
});

/**
 * Restore a mapping table snapshot — the shared inverse action for
 * `completeMidiLearn` and `removeMidiMapping` undo, mirroring
 * `restoreChordTrackState`. Conflict-checked: only applies when the live
 * table still matches what the original mutation is expected to have
 * produced, so an undo can't silently clobber a concurrent collaborator edit.
 */
export const handleRestoreMidiLearnMappings = createHandler<'restoreMidiLearnMappings'>({
    execute: (action) => {
        const state = midiLearnStore.value;
        if (!state) {
            return { status: 'no-write' };
        }

        const currentSnapshot = snapshotMappings(state.mappings);
        const matchesExpected = JSON.stringify(currentSnapshot) === JSON.stringify(action.payload.expected);
        if (!matchesExpected) {
            return { status: 'conflict' };
        }

        midiLearnStore.set({ ...state, mappings: cloneSnapshotMappings(action.payload.replacement) });
        return { status: 'written' };
    },
    describe: (action) => ({
        label: 'Restore MIDI mappings',
        inverseAction: {
            type: 'restoreMidiLearnMappings',
            payload: { expected: action.payload.replacement, replacement: action.payload.expected },
        },
    }),
    undoable: true,
});
