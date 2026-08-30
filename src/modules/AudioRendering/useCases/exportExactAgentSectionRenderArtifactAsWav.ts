import { isNativeProjectRuntimeAvailable } from '#/modules/Project/useCases';
import { type RenderProjectSectionJobSnapshot } from '#/utils/handlerContract';

import { downloadAudioWav } from '../repositories/audioExport/downloadAudioWav';

import { audioBufferToWav } from './audioBufferToWav';
import { selectNativeAudioExportFile } from './audioExport/selectNativeAudioExportFile';
import { writeNativeAudioMixdownFile } from './audioExport/writeNativeAudioMixdownFile';
import { getExactAgentSectionRenderArtifact } from './getExactAgentSectionRenderArtifact';

type ExactArtifactBinding = { job: RenderProjectSectionJobSnapshot; sourceRevision: string };

/** Exports only the retained buffer, through the normal browser or desktop export boundary. */
export async function exportExactAgentSectionRenderArtifactAsWav(binding: ExactArtifactBinding): Promise<boolean> {
    const artifact = getExactAgentSectionRenderArtifact(binding);
    if (!artifact) {
        throw new Error('The exact retained section render is unavailable.');
    }
    const bytes = await audioBufferToWav(artifact.buffer);
    const filename = `${binding.job.sectionName}.wav`;
    if (isNativeProjectRuntimeAvailable()) {
        const selectedFilePath = await selectNativeAudioExportFile({ formats: ['wav'], suggestedName: filename });
        if (!selectedFilePath) {
            return false;
        }
        await writeNativeAudioMixdownFile({ bytes: new Uint8Array(bytes), format: 'wav', selectedFilePath });
        return true;
    }
    downloadAudioWav(bytes, filename);
    return true;
}
