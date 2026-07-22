import { logger } from '#/infra/logger/appLogger';
import { resetAudioGraph } from '#/modules/AudioEngine/useCases';
import { executeAppAction } from '#/modules/Command/useCases';
import { stopPlayback } from '#/modules/Transport/useCases';

import { templates } from './helpers';

export async function createFromTemplate(templateId: string): Promise<boolean> {
    const template = templates.find((time) => time.id === templateId);
    if (!template) {
        return false;
    }
    try {
        // Stop any in-flight playback and tear down the previous project's audio
        // graph before the template mutates stores or creates its own strips.
        await stopPlayback();
        resetAudioGraph();
        if (template.executionBoundary === 'project-replacement') {
            return await template.create();
        }
        await executeAppAction({ type: 'createProjectFromTemplate', payload: { templateId } });
        return true;
    } catch (error) {
        logger.warn(`[createFromTemplate] Failed to create template "${templateId}":`, error);
        return false;
    }
}
