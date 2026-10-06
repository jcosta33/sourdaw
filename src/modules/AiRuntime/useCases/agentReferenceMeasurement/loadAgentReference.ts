import { analyzeAgentReferenceBuffer } from '#/modules/AudioAnalysis/useCases';
import { decodeAudioFileBuffer } from '#/modules/AudioEngine/useCases';
import { pickFiles } from '#/modules/Project/useCases';
import { getAudioBufferContentAddress } from '#/utils/agentRenderReceipt';
import { AUDIO_EXTENSION_ROSTER } from '#/utils/audioFileExtensions';
import { basename_from_path } from '#/utils/path-basename';

import {
    AGENT_REFERENCE_MAX_DURATION_SECONDS,
    AGENT_REFERENCE_MAX_FILE_BYTES,
    AGENT_REFERENCE_MAX_NAME_LENGTH,
} from '../../models/AgentReferenceLimits';
import { beginAgentReferenceLoad, storeAgentReference } from '../../stores/agentReferenceStore';

/** Why a chosen file left no reference behind. */
type AgentReferenceLoadFailure =
    'file-unavailable' | 'file-too-large' | 'undecodable-audio' | 'empty-audio' | 'too-long' | 'measurement-failed';

/** `superseded`: a clear or a newer load came first, so what this load measured was dropped. */
type LoadAgentReferenceResult =
    | { status: 'loaded' }
    | { status: 'cancelled' }
    | { status: 'superseded' }
    | { status: 'failed'; reason: AgentReferenceLoadFailure };

function failed(reason: AgentReferenceLoadFailure): LoadAgentReferenceResult {
    return { status: 'failed', reason };
}

async function pickReferenceFile(): Promise<File | null | 'unavailable'> {
    try {
        const files = await pickFiles({ filters: [{ name: 'Audio', extensions: [...AUDIO_EXTENSION_ROSTER] }] });
        return files?.[0] ?? null;
    } catch {
        return 'unavailable';
    }
}

async function decodeReference(file: File): Promise<AudioBuffer | null> {
    try {
        return await decodeAudioFileBuffer(file);
    } catch {
        return null;
    }
}

/**
 * Let the user choose one audio file as the reference the planner compares the project to.
 *
 * The file is decoded into a buffer this call alone holds, never into `audioBufferCache`, measured
 * once with the full agent metric set, and let go. What the session keeps is the figures, the
 * file's base name for display, and the audio's content address: no sample, no path, no buffer. A
 * file that cannot be read leaves the earlier reference, if any, exactly as it was.
 */
export async function loadAgentReference(): Promise<LoadAgentReferenceResult> {
    const loadEpoch = beginAgentReferenceLoad();
    const file = await pickReferenceFile();
    if (file === 'unavailable') {
        return failed('file-unavailable');
    }
    if (file === null) {
        return { status: 'cancelled' };
    }
    if (file.size > AGENT_REFERENCE_MAX_FILE_BYTES) {
        return failed('file-too-large');
    }
    const buffer = await decodeReference(file);
    if (buffer === null) {
        return failed('undecodable-audio');
    }
    if (buffer.length === 0) {
        return failed('empty-audio');
    }
    if (buffer.duration > AGENT_REFERENCE_MAX_DURATION_SECONDS) {
        return failed('too-long');
    }
    try {
        const analysis = analyzeAgentReferenceBuffer(buffer);
        const contentAddress = await getAudioBufferContentAddress(buffer);
        const stored = storeAgentReference({
            loadEpoch,
            reference: {
                referenceId: `reference-${crypto.randomUUID()}`,
                name: basename_from_path(file.name).slice(0, AGENT_REFERENCE_MAX_NAME_LENGTH),
                contentAddress,
                ...analysis,
            },
        });
        return stored ? { status: 'loaded' } : { status: 'superseded' };
    } catch {
        return failed('measurement-failed');
    }
}
