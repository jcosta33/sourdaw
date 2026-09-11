import { afterEach, describe, expect, it } from 'vitest';

import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { type AppAction } from '#/utils/handlerContract';

import { compileVersionedCommandBatchEnvelope } from '../compileVersionedCommandBatchEnvelope';
import { createExecutionCommandEnvelope } from '../createExecutionCommandEnvelope';
import { describeCommandBatchRecovery } from '../describeCommandBatchRecovery';
import { parseVersionedCommandBatchEnvelope } from '../parseVersionedCommandBatchEnvelope';
import { serializeVersionedCommandEnvelope } from '../serializeVersionedCommandEnvelope';

const REVISION = 'revision-1';
const RENAME_ACTION: AppAction = { type: 'renameTrack', payload: { trackId: 'track-1', name: 'Lead' } };
const INVERSE_ACTION: AppAction = { type: 'renameTrack', payload: { trackId: 'track-1', name: 'Old' } };
const GAIN_ACTION: AppAction = { type: 'setTrackGain', payload: { trackId: 'track-1', gain: 0.5, expectedGain: 1 } };
const GAIN_INVERSE_ACTION: AppAction = {
    type: 'setTrackGain',
    payload: { trackId: 'track-1', gain: 1, expectedGain: 0.5 },
};
const PAN_ACTION: AppAction = { type: 'setTrackPan', payload: { trackId: 'track-1', pan: -0.5, expectedPan: 0 } };

const baseHandler = {
    describe: () => ({ label: 'Rename' }),
    execute: () => ({ status: 'written' as const }),
    undoable: true,
    validate: () => true,
};

function batchOf(actions: readonly AppAction[]) {
    const commands = actions.map(
        (action) =>
            createExecutionCommandEnvelope({
                action,
                expectedEffect: `Execute ${action.type}`,
                normalizedProjectRevision: REVISION,
            }).envelope
    );
    const compiled = compileVersionedCommandBatchEnvelope({
        baseRevision: REVISION,
        batchId: 'batch-recovery',
        commands: commands.map(serializeVersionedCommandEnvelope),
        intent: 'Rename tracks',
        mode: 'preview',
        projectId: 'project-1',
        runId: 'run-recovery',
    });
    const parsed = parseVersionedCommandBatchEnvelope(compiled.serialized, compiled.authority);
    if (parsed.status === 'invalid') {
        throw new Error(parsed.reason);
    }
    return parsed.envelope;
}

describe('describeCommandBatchRecovery', () => {
    afterEach(() => {
        clearHandlerRegistry();
    });

    // Red when `describeCommandBatchRecovery` keys one command's recovery onto another's id, or
    // collapses a batch of mixed recoveries onto a single class.
    it('describes every command in a batch by its own command id', () => {
        registerHandlerMap({
            renameTrack: { ...baseHandler, describe: () => ({ label: 'Rename', inverseAction: INVERSE_ACTION }) },
            // An inverse a non-undoable handler cannot replay only compensates for the write.
            setTrackGain: {
                ...baseHandler,
                describe: () => ({ label: 'Set gain', inverseAction: GAIN_INVERSE_ACTION }),
                undoable: false,
            },
            setTrackPan: { ...baseHandler, describe: () => ({ label: 'Set pan' }), undoable: false },
        });
        const envelope = batchOf([RENAME_ACTION, GAIN_ACTION, PAN_ACTION]);
        const [renameCommand, gainCommand, panCommand] = envelope.commands;

        const described = describeCommandBatchRecovery(envelope);

        expect(described).toEqual({
            status: 'described',
            recoveryByCommandId: {
                [renameCommand!.commandId]: 'inverse',
                [gainCommand!.commandId]: 'compensable',
                [panCommand!.commandId]: 'irreversible',
            },
        });
        expect(new Set([renameCommand!.commandId, gainCommand!.commandId, panCommand!.commandId]).size).toBe(3);
    });

    // Red when an unresolvable handler yields a described result instead of a rejection.
    it('rejects a batch whose action has no registered handler', () => {
        const envelope = batchOf([RENAME_ACTION]);
        clearHandlerRegistry();

        expect(describeCommandBatchRecovery(envelope)).toEqual({
            status: 'rejected',
            reason: 'Executable command is not completely registered: renameTrack',
        });
    });

    // Red when a throwing `describe` is swallowed into a recovery instead of rejecting the batch.
    it('rejects a batch whose handler cannot describe the action', () => {
        registerHandlerMap({
            renameTrack: {
                ...baseHandler,
                describe: () => {
                    throw new Error('missing track');
                },
            },
        });
        const envelope = batchOf([RENAME_ACTION]);

        expect(describeCommandBatchRecovery(envelope)).toEqual({
            status: 'rejected',
            reason: 'Could not preflight renameTrack: missing track',
        });
    });
});
