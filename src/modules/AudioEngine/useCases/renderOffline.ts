import { captureOfflineRenderInput } from './offlineRender/captureOfflineRenderInput';
import { executeOfflineRender } from './offlineRender/executeOfflineRender';
import { type OfflineRenderOptions } from './offlineRender/types';

type RenderOfflineFn = {
    (opts: OfflineRenderOptions): Promise<AudioBuffer>;
    (durationBeats: number, sampleRate?: number): Promise<AudioBuffer>;
};

/** Compatible live-project entry point; all project reads finish before the renderer can suspend. */
export const renderOffline: RenderOfflineFn = async (
    optsOrBeats: OfflineRenderOptions | number,
    sampleRate?: number
) => {
    const options = typeof optsOrBeats === 'number' ? { durationBeats: optsOrBeats, sampleRate } : optsOrBeats;
    return executeOfflineRender(() => captureOfflineRenderInput(options), options);
};
