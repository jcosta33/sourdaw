import { createHandler } from '#/utils/createHandler';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { setSoloSafe } from '../../useCases/toggleTrackState/setSoloSafe';

import { toSoloStateExecutionResult } from './toSoloStateExecutionResult';

/**
 * Toggling again is not a collaboration-safe inverse: it re-reads whatever the flag
 * happens to be at undo time, so a change landing in between is flipped rather than
 * restored. This resolves the target value from the live track and routes both the write
 * and its inverse through the guarded `setSoloSafe` / `restoreSoloSafe` contract, which
 * conflicts on divergence and defers the engine's solo reconciliation until the project
 * transaction commits.
 */
export const handleToggleSoloSafe = createHandler<'toggleSoloSafe'>({
    execute: (action) => {
        const track = getTrackStoreState()?.tracks.find((candidate) => candidate.id === action.payload.trackId);
        if (!track) {
            return { status: 'no-write' };
        }
        return toSoloStateExecutionResult(
            setSoloSafe({
                trackId: track.id,
                soloSafe: !track.soloSafe,
                deferRuntimeEffect: true,
            })
        );
    },
    describe: (action) => {
        const track = getTrackStoreState()?.tracks.find((candidate) => candidate.id === action.payload.trackId);
        return {
            label: 'Toggle solo safe',
            inverseAction: track
                ? {
                      type: 'restoreSoloSafe',
                      payload: {
                          trackId: track.id,
                          expected: !track.soloSafe,
                          replacement: track.soloSafe,
                      },
                  }
                : null,
            redoAction: track
                ? {
                      type: 'restoreSoloSafe',
                      payload: {
                          trackId: track.id,
                          expected: track.soloSafe,
                          replacement: !track.soloSafe,
                      },
                  }
                : action,
        };
    },
    undoable: true,
});
