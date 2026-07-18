import { quantizeTransients } from '#/modules/ElasticAudio/useCases';
import { createHandler } from '#/utils/createHandler';
import { notifyUser } from '#/utils/Notification/notifyUser';

export const handleQuantizeTransients = createHandler<'quantizeTransients'>({
    execute: (a) => {
        const result = quantizeTransients(a.payload.clipId);
        if (!result.ok) {
            const messages: Record<typeof result.reason, string> = {
                CLIP_NOT_FOUND: 'Clip not found',
                CLIP_NOT_AUDIO: 'Quantize only works on audio clips',
                NO_MARKERS: 'No transients detected — run Detect Transients first',
            };
            notifyUser(messages[result.reason], 'error');
            return;
        }
        notifyUser(`Quantized ${result.moved} transients to the grid`, 'success');
    },
    describe: () => ({ label: 'Quantize to Grid (Elastic Audio)' }),
    undoable: true,
});
