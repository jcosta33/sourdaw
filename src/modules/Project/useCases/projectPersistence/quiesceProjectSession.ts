import { resetAudioGraph } from '#/modules/AudioEngine/useCases';
import { unloadPlugin } from '#/modules/PluginHost/useCases';
import { stopPlayback } from '#/modules/Transport/useCases';

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
    resetAudioGraph();
    try {
        await unloadPlugin();
    } catch {
        // The live graph is already gone. Closing is safer than restoring a
        // partially retired plugin session, and the native host remains live.
    }
    quiesced = true;
    return true;
}
