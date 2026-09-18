import {
    branchStateAuthority,
    type BranchSessionHandle,
    type BranchStateCommitResult,
} from '../repositories/branchStateAuthority';
import { validateStoredBranchStoreState } from '../stores/branchStore';

/**
 * Publish the branch list a collaboration session received from its peers.
 *
 * The state is sanitised here because it arrives from a peer: an invite is an
 * unconditional write bearer credential, so the branch records in the shared
 * `__branches__` document are untrusted input, and this is the boundary where
 * they become durable. Refused as `superseded` once the session no longer owns
 * the durable list, so a session that lost ownership stops writing instead of
 * fighting the owner, and as `reset-pending` while a project reset owns the
 * envelope — the list this session projects describes the project being
 * replaced.
 */
export function projectBranchSession(
    handle: BranchSessionHandle,
    state: unknown
): Promise<BranchStateCommitResult<'superseded' | 'reset-pending'>> {
    return branchStateAuthority.projectSession(handle, validateStoredBranchStoreState(state));
}
