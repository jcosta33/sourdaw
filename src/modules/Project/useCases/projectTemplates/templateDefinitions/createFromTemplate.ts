import { logger } from '#/infra/logger/appLogger';
import { resetAudioGraph } from '#/modules/AudioEngine/useCases';
import { executeAppAction } from '#/modules/Command/useCases';
import { ensureTrackStrips, stopPlayback } from '#/modules/Transport/useCases';

import { templates } from './helpers';

export async function createFromTemplate(templateId: string): Promise<boolean> {
    const template = templates.find((time) => time.id === templateId);
    if (!template) {
        return false;
    }
    let graphWasReset = false;
    try {
        if (template.executionBoundary === 'project-replacement') {
            return await template.create();
        }
        await stopPlayback();
        resetAudioGraph();
        graphWasReset = true;
        await executeAppAction({ type: 'createProjectFromTemplate', payload: { templateId } });
        return true;
    } catch (error) {
        if (graphWasReset) {
            resetAudioGraph();
            ensureTrackStrips();
        }
        logger.warn(`[createFromTemplate] Failed to create template "${templateId}":`, error);
        return false;
    }
}
