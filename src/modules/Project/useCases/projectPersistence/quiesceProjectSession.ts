import { resetAudioGraph } from '#/modules/AudioEngine/useCases';
import { unloadPlugin } from '#/modules/PluginHost/useCases';
import { repairRuntimeGraphFromProject, stopPlayback } from '#/modules/Transport/useCases';

/** Retire only renderer-owned project runtime before a macOS window closes. */
export async function quiesceProjectSession(
    beginDestructiveTeardown: () => Promise<boolean> = async () => true
): Promise<boolean> {
    if (quiesced) {
        return true;
    }
    inFlight ??= quiesce(beginDestructiveTeardown);
    return inFlight;
}

let inFlight: Promise<boolean> | undefined;
let quiesced = false;

async function quiesce(beginDestructiveTeardown: () => Promise<boolean>): Promise<boolean> {
    try {
        await stopPlayback();
    } catch {
        inFlight = undefined;
        return false;
    }
    let committed: boolean;
    try {
        committed = await beginDestructiveTeardown();
    } catch {
        inFlight = undefined;
        return false;
    }
    if (!committed) {
        inFlight = undefined;
        return false;
    }
    try {
        resetAudioGraph();
        await unloadPlugin();
    } catch {
        // `unloadPlugin` can fail after graph reset. Restore through the
        // existing Project/Transport runtime-repair path before returning
        // control to a reusable Dock-hosted application window.
        try {
            await repairRuntimeGraphFromProject();
        } catch {
            // No close approval is emitted. The renderer remains blocked from
            // teardown and the caller can surface its existing recovery path.
        }
        inFlight = undefined;
        return false;
    }
    quiesced = true;
    return true;
}
