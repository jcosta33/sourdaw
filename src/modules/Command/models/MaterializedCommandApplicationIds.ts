import { type AppAction } from '#/utils/handlerContract';

import { type CommandApplicationAssignedId } from './VersionedCommandEnvelope';

export type MaterializedCommandApplicationIds = {
    action: AppAction;
    applicationAssignedIds: readonly CommandApplicationAssignedId[];
};

/**
 * Application defaults are drawn from pools shared by the whole session — the next track colour is
 * taken from a palette that advances on every draw. Only a command that can reach the project may
 * draw one; a caller that compiles a command to measure it passes `false` and leaves the pool where
 * it found it.
 */
export type CommandApplicationDefaults = { reserveApplicationDefaults: boolean };
