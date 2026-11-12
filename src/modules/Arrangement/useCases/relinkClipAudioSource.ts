import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import { executeUserAppAction, isAppActionCommittedError } from '#/modules/Command/useCases';
import { captureProjectIdentity } from '#/modules/CrdtDocument/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { captureRelinkAudioSourceTargets, relinkAudioSourceTargetsMatch } from './clipEditing/relinkAudioSourceTargets';

export type RelinkClipAudioSourceInput = {
    sourceBufferId: string;
    replacementBufferId: string;
    shouldExecute?: () => boolean;
};

export type RelinkClipAudioSourceResult =
    | Readonly<{ status: 'relinked'; relinkedClipIds: readonly string[] }>
    | Readonly<{ status: 'source-not-missing' }>
    | Readonly<{ status: 'rejected' }>;

/** Repair the live arrangement and its track alternatives as one guarded source edit. */
export async function relinkClipAudioSource({
    sourceBufferId,
    replacementBufferId,
    shouldExecute,
}: RelinkClipAudioSourceInput): Promise<RelinkClipAudioSourceResult> {
    if (!sourceBufferId || !replacementBufferId || sourceBufferId === replacementBufferId) {
        return { status: 'rejected' };
    }
    if (getCachedAudioBuffer({ bufferId: sourceBufferId }) !== null) {
        return { status: 'source-not-missing' };
    }
    const targets = captureRelinkAudioSourceTargets(sourceBufferId, replacementBufferId);
    if (!relinkAudioSourceTargetsMatch(targets)) {
        return { status: 'rejected' };
    }
    const identity = captureProjectIdentity();
    const isCurrent = (): boolean =>
        captureProjectIdentity() === identity &&
        shouldExecute?.() !== false &&
        getCachedAudioBuffer({ bufferId: sourceBufferId }) === null;
    let committed = false;
    try {
        await executeUserAppAction(
            { type: 'relinkClipAudioSources', payload: { targets } },
            {
                shouldExecute: isCurrent,
                shouldCommit: isCurrent,
                onCommitted: () => {
                    committed = true;
                },
            }
        );
    } catch (error) {
        if (!committed && !isAppActionCommittedError(error)) {
            throw error;
        }
        committed = true;
        notifyUser(error instanceof Error ? error.message : 'Audio source relink committed with a warning', 'warning');
    }
    if (!committed) {
        return { status: 'rejected' };
    }
    return { status: 'relinked', relinkedClipIds: [...new Set(targets.map((target) => target.clipId))] };
}
