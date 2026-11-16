import { createUserAppActionRefusalEpisodes } from '#/modules/Command/useCases';

import { toasterStore } from '../stores/toasterStore';

import { commitToasterKit } from './commitToasterKit';
import { isToasterKitDocumented } from './isToasterKitDocumented';

/**
 * The one set of refusal episodes for every Toaster commit route: the kit
 * persistence subscription and the morph commit both write a device's kit, so a
 * refusal on either announces once per device, and either route's success ends
 * the episode. When the project can be changed again the device's session kit
 * is written once, so edits refused while it was locked are not lost; a kit the
 * document already holds (a peer's kit reconciled in while locked) is not
 * written again.
 */
export const toasterRefusalEpisodes = createUserAppActionRefusalEpisodes({
    onAdmitted: (deviceId) => {
        const kit = toasterStore.value?.[deviceId]?.kit;
        if (!kit || isToasterKitDocumented(deviceId, kit)) {
            return;
        }
        commitToasterKit(deviceId, toasterRefusalEpisodes);
    },
});
