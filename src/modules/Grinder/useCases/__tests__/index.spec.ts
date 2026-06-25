import { describe, it, expect } from 'vitest';

import { exportGrinderNeuralModel } from '../exportGrinderNeuralModel';
import { moveGrinderPedalInChainWithAudio } from '../grinderParamBridge/moveGrinderPedalInChainWithAudio';
import { recallGrinderSnapshotWithAudio } from '../grinderParamBridge/recallGrinderSnapshotWithAudio';
import * as grinderUseCases from '../index';
import { removeGrinderNeuralModel } from '../removeGrinderNeuralModel';

/**
 * The `useCases/index.ts` barrel is the public surface of the Grinder module's
 * use cases. Consumers (e.g. GrinderPanel) must be able to reach every public
 * param-bridge and Neural-library use case through it. `syncGrinderPatchToAudio`
 * is an internal collaborator of the param-bridge use cases and is intentionally
 * NOT part of the public surface.
 */
describe('Grinder useCases barrel', () => {
    it('re-exports recallGrinderSnapshotWithAudio identically to its source module', () => {
        expect(grinderUseCases.recallGrinderSnapshotWithAudio).toBe(recallGrinderSnapshotWithAudio);
    });

    it('re-exports moveGrinderPedalInChainWithAudio identically to its source module', () => {
        expect(grinderUseCases.moveGrinderPedalInChainWithAudio).toBe(moveGrinderPedalInChainWithAudio);
    });

    it('re-exports removeGrinderNeuralModel identically to its source module', () => {
        expect(grinderUseCases.removeGrinderNeuralModel).toBe(removeGrinderNeuralModel);
    });

    it('re-exports exportGrinderNeuralModel identically to its source module', () => {
        expect(grinderUseCases.exportGrinderNeuralModel).toBe(exportGrinderNeuralModel);
    });

    it('keeps syncGrinderPatchToAudio off the public surface', () => {
        expect('syncGrinderPatchToAudio' in grinderUseCases).toBe(false);
    });
});
