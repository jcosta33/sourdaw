import { type captureOfflineRenderInput } from './captureOfflineRenderInput';
import { executeOfflineRender } from './executeOfflineRender';
import { type OfflineRenderOptions } from './types';

/** Render one explicitly captured full-mix request under the shared export admission lock. */
export function renderOfflineInput(
    input: ReturnType<typeof captureOfflineRenderInput>,
    callbacks: Pick<OfflineRenderOptions, 'onProgress' | 'onWarning'> = {}
): Promise<AudioBuffer> {
    return executeOfflineRender(() => input, callbacks);
}
