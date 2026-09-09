import { handleAddYeastProcessor } from '../handlers/addYeastProcessor';
import { handleRemoveYeastProcessor } from '../handlers/removeYeastProcessor';
import { handleReorderYeastProcessor } from '../handlers/reorderYeastProcessor';
import { handleSetYeastArpPattern } from '../handlers/setYeastArpPattern';
import { handleSetYeastProcessorBypass } from '../handlers/setYeastProcessorBypass';
import { handleSetYeastProcessorParam } from '../handlers/setYeastProcessorParam';

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
