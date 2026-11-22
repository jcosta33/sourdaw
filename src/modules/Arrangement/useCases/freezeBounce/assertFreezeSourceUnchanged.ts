import { digestFreezePrintInput } from './digestFreezePrintInput';
import { CHANGED_DURING_FREEZE } from './freezeChangedMessage';
import { readLiveFreezePrintInput } from './readLiveFreezePrintInput';

/**
 * The render read the input captured before it started, but edits that carry an unfrozen stamp
 * (agent batches, user edits) can land while the track is still "freezing". Committing the take
 * then would pin a buffer and signature to a source the track no longer has. Throws, so the freeze
 * ends as any failed render does: unfrozen, nothing cached.
 *
 * Synchronous: the live input is selected and digested in one read, so nothing can land between
 * this check and the commit that follows it. An edit undone before the commit passes, and rightly:
 * the take was rendered from the captured input, which the live one matches again.
 */
export function assertFreezeSourceUnchanged(trackId: string, renderedSignature: string): void {
    const live = readLiveFreezePrintInput(trackId);
    if (!live || digestFreezePrintInput(live) !== renderedSignature) {
        throw new Error(CHANGED_DURING_FREEZE);
    }
}
