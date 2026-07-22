import { logger } from '#/infra/logger/appLogger';
import { resetAudioGraph } from '#/modules/AudioEngine/useCases';
import { executeAppAction, isAppActionCommittedError } from '#/modules/Command/useCases';
import { ensureTrackStrips, stopPlayback } from '#/modules/Transport/useCases';

import { templates } from './helpers';

function restoreAudioGraph(templateId: string): void {
    try {
        resetAudioGraph();
    } catch (error) {
        logger.warn(`[createFromTemplate] Failed to reset graph while recovering "${templateId}":`, error);
    }
    try {
        ensureTrackStrips();
    } catch (error) {
        logger.warn(`[createFromTemplate] Failed to rebuild graph while recovering "${templateId}":`, error);
    }
}

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
        graphWasReset = true;
        resetAudioGraph();
        await executeAppAction(
            { type: 'createProjectFromTemplate', payload: { templateId } },
            { skipMacroRecording: true }
        );
        return true;
    } catch (error) {
        if (graphWasReset) {
            restoreAudioGraph(templateId);
        }
        if (isAppActionCommittedError(error)) {
            logger.warn(`[createFromTemplate] Template "${templateId}" committed with recovery errors:`, error);
            return true;
        }
        logger.warn(`[createFromTemplate] Failed to create template "${templateId}":`, error);
        return false;
    }
}
