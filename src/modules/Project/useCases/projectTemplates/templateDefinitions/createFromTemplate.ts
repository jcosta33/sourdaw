import { logger } from '#/infra/logger/appLogger';
import { resetAudioGraph } from '#/modules/AudioEngine/useCases';
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
        // Non-demo templates call newProject() which also stops/resets, but both
        // operations are idempotent so the double-call is harmless.
        await stopPlayback();
        resetAudioGraph();
        return await template.create();
    } catch (error) {
        logger.warn(`[createFromTemplate] Failed to create template "${templateId}":`, error);
        return false;
    }
}
