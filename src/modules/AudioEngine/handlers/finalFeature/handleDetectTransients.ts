import { createHandler } from '#/utils/createHandler';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { detectTransientsForClip } from '../../useCases/elasticAudio/detectTransientsForClip';

export const handleDetectTransients = createHandler<'detectTransients'>({
    execute: (a) => {
        const result = detectTransientsForClip(a.payload.clipId, a.payload.sensitivity ?? 0.5);
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
