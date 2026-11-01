import { type ProjectContext } from '../../models/ProjectContext';

import { clipProtectionReading, type ExplicitClipProtection } from './clipProtectionReading';

export function getExplicitClipProtection(prompt: string, context: ProjectContext): ExplicitClipProtection {
    const { clips, complete } = clipProtectionReading.read(prompt, context);
    return { clips, complete };
}
