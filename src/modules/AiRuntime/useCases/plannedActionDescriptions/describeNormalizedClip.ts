import { type AppAction } from '#/utils/handlerContract';

import { type ProjectContext } from '../../models/ProjectContext';
import { findContextClip } from '../../transformers/findContextClip';

export function describeNormalizedClip(
    action: Extract<AppAction, { type: 'normalizeClip' }>,
    context: ProjectContext
): string {
    const clip = findContextClip(context, action.payload.clipId);
    const target = clip ? ` clip "${clip.name}"` : ' clip';
    const mode = action.payload.mode ?? 'peak';
    if (mode === 'peak') {
        return `Normalize${target} using peak measurement`;
    }
    const targetDb = action.payload.targetDb ?? -14;
    if (mode === 'lufs') {
        return `Normalize${target} to ${String(targetDb)} LUFS`;
    }
    return `Normalize${target} to ${String(targetDb)} dB RMS`;
}
