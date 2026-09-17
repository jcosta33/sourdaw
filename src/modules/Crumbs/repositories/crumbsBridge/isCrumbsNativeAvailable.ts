import { isDesktopRuntime } from '#/utils/desktopBridge';

/**
 * Whether a native Crumbs instance is even in question in this runtime.
 *
 * False in the browser build, where the sampler is the Web Audio worklet node
 * built with the strip and no `create_crumbs` exists to answer for it. Asked
 * here rather than at each caller so that "there is no native side" and "the
 * native side refused" stay two different answers.
 */
export function isCrumbsNativeAvailable(): boolean {
    return isDesktopRuntime();
}
