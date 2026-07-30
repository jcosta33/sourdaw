import { beforeEach, describe, expect, it, vi } from 'vitest';

import { executeAppAction } from '#/modules/Command/useCases';

import { type CallableCommandEntry } from '../../searchCommandRegistry';
import { trackCommands } from '../TrackCommands';

vi.mock('#/modules/Command/useCases', () => ({ executeAppAction: vi.fn().mockResolvedValue(undefined) }));
vi.mock('#/modules/Arrangement/useCases', () => ({ duplicateTrack: vi.fn(), removeTrack: vi.fn() }));
vi.mock('#/modules/Arrangement/stores', () => ({ trackStore: { value: { tracks: [] } } }));
vi.mock('#/utils/Notification/promptUser', () => ({ promptUser: vi.fn() }));
vi.mock('../../selectionHelpers/getSelectedTrackId', () => ({ getSelectedTrackId: () => null }));

function runAction(command: CallableCommandEntry | undefined): void {
    if (!command || typeof command.action !== 'function') {
        throw new Error('Expected a callable command action');
    }

    command.action();
}

describe('trackCommands', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('dispatches a fresh createBus action for every add-bus invocation', () => {
        const command = trackCommands.find((candidate) => candidate.id === 'add-bus');

        runAction(command);
        runAction(command);

        expect(executeAppAction).toHaveBeenCalledTimes(2);
        const firstAction = vi.mocked(executeAppAction).mock.calls[0]?.[0];
        const secondAction = vi.mocked(executeAppAction).mock.calls[1]?.[0];
        expect(firstAction).toEqual({ type: 'createBus', payload: { name: 'Bus' } });
        expect(secondAction).toEqual({ type: 'createBus', payload: { name: 'Bus' } });
        expect(firstAction).not.toBe(secondAction);
        if (firstAction?.type !== 'createBus' || secondAction?.type !== 'createBus') {
            throw new Error('Expected createBus actions');
        }
        expect(firstAction.payload).not.toBe(secondAction.payload);
    });
});
