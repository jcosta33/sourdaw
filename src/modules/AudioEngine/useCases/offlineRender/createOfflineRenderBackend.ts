/**
 * The one place the offline render chooses its `AudioGraphBackend`.
 *
 * `renderOffline` is the seam's sole production consumer, and today the answer
 * is fixed: the Web Audio offline backend is the shipping renderer. The native
 * backend (`createNativeOfflineGraphBackend` in `repositories/nativeGraph/`,
 * backendId `native/offline`) is constructible and proven — the live/offline
 * null test drives it against the web leg over the shared fixture set — but it
 * cannot occupy this slot yet, because the export still reaches through the
 * web implementation's own surface (`getTrackStrip`, sidechain and Toaster
 * routing, clip/note scheduling) rather than the contract.
 *
 * **The selection flips here, in D3.c (#2214)**: when the export's graph work
 * arrives entirely through commands, this function becomes the composition
 * decision between `web-audio/offline` and `native/offline`, and nothing else
 * in the render path moves.
 */

import {
    createWebAudioOfflineBackend,
    type WebAudioOfflineBackendDeps,
    type WebAudioOfflineBackend,
} from './createWebAudioOfflineBackend';

export function createOfflineRenderBackend(deps: WebAudioOfflineBackendDeps): WebAudioOfflineBackend {
    return createWebAudioOfflineBackend(deps);
}
