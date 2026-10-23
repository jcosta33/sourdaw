import { detectTransientsForClip } from '#/modules/ElasticAudio/useCases';
import { defaultPreferences } from '#/modules/Preferences/useCases';
import { preferencesStore } from '#/modules/Preferences/stores';
import { createHandler } from '#/utils/createHandler';
import { notifyUser } from '#/utils/Notification/notifyUser';

export const handleDetectTransients = createHandler<'detectTransients'>({
    execute: (a) => {
        const sensitivity =
            a.payload.sensitivity ??
            preferencesStore.value?.elasticTransientSensitivity ??
            defaultPreferences.elasticTransientSensitivity;
        const result = detectTransientsForClip(a.payload.clipId, sensitivity);
        if (!result.ok) {
            const messages: Record<typeof result.reason, string> = {
                CLIP_NOT_FOUND: 'Clip not found',
                CLIP_NOT_AUDIO: 'Transient detection only works on audio clips',
                NO_BUFFER: 'Audio buffer is missing or still loading',
                NO_TEMPO: 'Cannot detect transients without a project tempo',
            };
            notifyUser(messages[result.reason], 'error');
            return;
        }
        notifyUser(`Detected ${result.added} transients (${result.kept} preserved)`, 'success');
    },
    describe: () => ({ label: 'Detect Transients' }),
    undoable: false,
});
