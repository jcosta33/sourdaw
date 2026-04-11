import { stopPlayback } from '#/modules/Transport/useCases';
import { resetAudioGraph } from '#/modules/AudioEngine/useCases';
import { templates } from './helpers';

export async function createFromTemplate(templateId: string): Promise<void> {
    const template = templates.find((t) => t.id === templateId);
    if (!template) {
        return;
    }
    // Stop any in-flight playback and tear down the previous project's audio
    // graph before the template mutates stores or creates its own strips.
    // Non-demo templates call newProject() which also stops/resets, but both
    // operations are idempotent so the double-call is harmless.
    stopPlayback();
    resetAudioGraph();
    await template.create();
}