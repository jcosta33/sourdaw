/**
 * The `web-audio/offline` half of the engine selection: the shipping Web Audio
 * graph backend, behind the seam's factory name.
 *
 * Which renderer an export gets is decided in `selectOfflineRenderEngine`
 * (#2225, D3.c.2); this factory is what a `web-audio/offline` selection — a
 * browser render, a degraded desktop render, or a native decline — constructs.
 */

import {
    createWebAudioOfflineBackend,
    type WebAudioOfflineBackendDeps,
    type WebAudioOfflineBackend,
} from './createWebAudioOfflineBackend';

export function createOfflineRenderBackend(deps: WebAudioOfflineBackendDeps): WebAudioOfflineBackend {
    return createWebAudioOfflineBackend(deps);
}
