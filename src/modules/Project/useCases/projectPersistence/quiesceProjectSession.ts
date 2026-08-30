import { resetAudioGraph } from '#/modules/AudioEngine/useCases';
import { unloadPlugin } from '#/modules/PluginHost/useCases';
import { stopPlayback } from '#/modules/Transport/useCases';

/** Retire only renderer-owned project runtime before a macOS window closes. */
export async function quiesceProjectSession(): Promise<boolean> {
    try {
        await stopPlayback();
        resetAudioGraph();
        await unloadPlugin();
        return true;
    } catch {
        return false;
    }
}
