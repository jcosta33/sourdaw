import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { type Modulator } from '../../models/Modulator';
import { addModulator } from '../../useCases/modulation/addModulator';

type AddModulatorAction = Extract<AppAction, { type: 'addModulator' }>;

// Mirror of handleAddMarker's ensureMarkerId: the inverse needs the new
// modulator's id before execute runs, so describe mints it onto the payload
// and execute reuses it (describe always runs before execute).
function ensureModulatorId(action: AddModulatorAction): string {
    if (action.payload.modulatorId) {
        return action.payload.modulatorId;
    }
    const modulatorId = `mod-${action.payload.modulator.kind}-${crypto.randomUUID()}`;
    action.payload.modulatorId = modulatorId;
    return modulatorId;
}

/** The contract's snapshot shape freezes a step modulator's steps for replay
 *  safety; the model holds a mutable array, so thaw rebuilds it with explicit
 *  keys and a fresh steps array. */
function thawModulator(snapshot: AddModulatorAction['payload']['modulator']): Omit<Modulator, 'id'> {
    let config: Modulator['config'];
    if (snapshot.config.kind === 'step') {
        config = {
            kind: snapshot.config.kind,
            steps: Array.from(snapshot.config.steps),
            rate: snapshot.config.rate,
            smooth: snapshot.config.smooth,
        };
    } else {
        config = snapshot.config;
    }
    return {
        name: snapshot.name,
        trackId: snapshot.trackId,
        kind: snapshot.kind,
        config,
        mappings: Array.from(snapshot.mappings),
        enabled: snapshot.enabled,
    };
}

export const handleAddModulator = createHandler<'addModulator'>({
    execute: (action) => {
        addModulator(thawModulator(action.payload.modulator), ensureModulatorId(action));
        return undefined;
    },
    describe: (action) => ({
        label: `Add ${action.payload.modulator.kind} modulator "${action.payload.modulator.name}"`,
        inverseAction: { type: 'removeModulator', payload: { modulatorId: ensureModulatorId(action) } },
    }),
    undoable: true,
});
