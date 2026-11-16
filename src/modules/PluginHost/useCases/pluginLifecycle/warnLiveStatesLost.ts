import { notifyUser } from '#/utils/Notification/notifyUser';

/** Tell the user which plugins come back without the edits a teardown could not read. */
export function warnLiveStatesLost(pluginIds: ReadonlySet<string>): void {
    if (pluginIds.size === 0) {
        return;
    }
    notifyUser(
        `Unsaved edits in ${[...pluginIds].join(', ')} could not be read before unloading — the plugin comes back without them.`,
        'warning'
    );
}
