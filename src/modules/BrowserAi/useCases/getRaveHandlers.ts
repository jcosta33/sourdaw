import { handleLoadRaveModel } from '../handlers/rave/handleLoadRaveModel';
import { handleSetRaveBlend } from '../handlers/rave/handleSetRaveBlend';

export type RaveHandlersMap = {
    loadRaveModel: typeof handleLoadRaveModel;
    setRaveBlend: typeof handleSetRaveBlend;
};

/**
 * Merges BrowserAi RAVE `ActionHandler` maps for Command. Does **not** call `createHandler` here.
 */
export function getRaveHandlers(): RaveHandlersMap {
    return {
        loadRaveModel: handleLoadRaveModel,
        setRaveBlend: handleSetRaveBlend,
    };
}
