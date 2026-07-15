import { executeAppAction } from '#/modules/Command/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

type DawAction = {
    type: string;
    payload?: unknown;
};

type DawApi = {
    version: string;
    notify: (message: string) => void;
    executeAction: (action: DawAction) => Promise<void>;
};

/**
 * Create the DAW API exposed to an editor script.
 * WARNING: This is NOT sandboxed — scripts get full executeAppAction access.
 */
export function createDawApi(): DawApi {
    return {
        version: '0.1.0',
        notify: (message: string) => {
            notifyUser(message);
        },
        // SECURITY: ExtensionManifest permissions are not enforced and script calls are not rate-limited.
        // A Worker sandbox remains required before this API ships.
        executeAction: async (action: DawAction) => {
            type AppAction = Parameters<typeof executeAppAction>[0];
            await executeAppAction(action as AppAction, { source: 'ai' });
        },
    };
}
