import { defaultPluginGuiState, pluginGuiStore, type PluginGuiStatus } from '../../stores/pluginGuiStore';

/**
 * Record what one plugin instance's editor is now doing.
 *
 * Every arrival writes through here — this app opening or closing the window,
 * the host refusing to, and the OS ending the window with nothing asking —
 * because the rack's control reads one state and a second writer is how the
 * control starts disagreeing with the screen.
 *
 * The status is stated by the caller rather than inferred, because the two parts
 * come apart: a close that was refused leaves the editor open *and* carries an
 * error, and a failed open leaves it closed.
 */
export function recordPluginGuiState(instanceId: string, status: PluginGuiStatus): void {
    pluginGuiStore.update((state) => {
        const current = state ?? defaultPluginGuiState;
        return {
            ...current,
            byInstanceId: { ...current.byInstanceId, [instanceId]: status },
        };
    });
}
