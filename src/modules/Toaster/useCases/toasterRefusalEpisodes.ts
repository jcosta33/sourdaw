import { createUserAppActionRefusalEpisodes } from '#/modules/Command/useCases';

import { commitToasterKit } from './commitToasterKit';

/**
 * The one set of refusal episodes for every Toaster commit route: the kit
 * persistence subscription and the morph commit both write a device's kit, so a
 * refusal on either announces once per device, and either route's success ends
 * the episode. When the project can be changed again the device's session kit
 * is written once, so edits refused while it was locked are not lost.
 */
export const toasterRefusalEpisodes = createUserAppActionRefusalEpisodes({
    onAdmitted: (deviceId) => {
        commitToasterKit(deviceId, toasterRefusalEpisodes);
    },
});
