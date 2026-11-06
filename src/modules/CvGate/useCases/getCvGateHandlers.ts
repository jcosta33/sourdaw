import { handleAddCvOutput } from '../handlers/cvOutput/handleAddCvOutput';
import { handleRemoveCvOutput } from '../handlers/cvOutput/handleRemoveCvOutput';

export type CvGateHandlersMap = {
    addCvOutput: typeof handleAddCvOutput;
    removeCvOutput: typeof handleRemoveCvOutput;
};

/** The CvGate `ActionHandler` map for Command: adding a CV/gate output and its undo inverse. */
export function getCvGateHandlers(): CvGateHandlersMap {
    return {
        addCvOutput: handleAddCvOutput,
        removeCvOutput: handleRemoveCvOutput,
    };
}
