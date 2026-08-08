import { type detectKey } from './keyDetection';

/**
 * Render a key-detection result as the one line every surface shows.
 *
 * Single-sourced on purpose. The context menu, the `detectKey` AppAction and
 * the LLM tool all speak through this, so none of them can grow a phrasing
 * that claims more than the detector measured — which is the whole failure
 * this function exists to prevent.
 */
export function describeDetectedKey(result: ReturnType<typeof detectKey>): string {
    if (!result) {
        return 'Could not detect key: no audio to analyse';
    }

    if (!result.detected) {
        return 'No key detected: the audio is atonal or broadband';
    }

    const confidencePercent = Math.round(result.confidence * 100);
    const base = `Detected key: ${result.key} ${result.mode} (${confidencePercent}% confidence)`;
    if (!result.alternative) {
        return base;
    }

    return `${base}, close call with ${result.alternative.key} ${result.alternative.mode}`;
}
