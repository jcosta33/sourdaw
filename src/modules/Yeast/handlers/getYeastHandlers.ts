import { handleAddYeastProcessor } from './addYeastProcessor';
import { handleRemoveYeastProcessor } from './removeYeastProcessor';
import { handleReorderYeastProcessor } from './reorderYeastProcessor';
import { handleSetYeastArpPattern } from './setYeastArpPattern';
import { handleSetYeastProcessorBypass } from './setYeastProcessorBypass';
import { handleSetYeastProcessorParam } from './setYeastProcessorParam';

/**
 * Merges the Yeast handler map for Command. Does **not** call `createHandler` here.
 *
 * Return type is inferred — TypeScript builds the precise object literal type
 * where every entry keeps its `ActionHandler<Extract<AppAction, …>>` shape.
 */
export function getYeastHandlers() {
    return {
        setYeastProcessorParam: handleSetYeastProcessorParam,
        setYeastArpPattern: handleSetYeastArpPattern,
        setYeastProcessorBypass: handleSetYeastProcessorBypass,
        addYeastProcessor: handleAddYeastProcessor,
        removeYeastProcessor: handleRemoveYeastProcessor,
        reorderYeastProcessor: handleReorderYeastProcessor,
    };
}
