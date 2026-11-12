import {
    type AtomicActionGroupRevert,
    type AtomicActionGroupRevertOptions,
    revertActionGroupsAtomically,
} from './revertActionGroupsAtomically';

/**
 * Revert every undo entry tagged with `groupId` as ONE atomic replay, the one `undo()` gives a
 * group at the head of `past`, wherever the group sits in `past`. Unlike `revertActionGroup`, which
 * replays member by member and keeps whatever it undid before a member refuses, nothing is written
 * unless every inverse applies: a group not applied whole, one holding a member without an inverse
 * command, and one whose inverses conflict with the project as it is now are refused and stay
 * exactly where they were. A caller's `shouldExecute` is the batch's own last authority check
 * before it writes: once it answers false, nothing is written and the group is refused as a conflict.
 * A replay that writes nothing rechecks that authority before consuming its unchanged history.
 */
export function revertActionGroupAtomically(
    groupId: string,
    options?: AtomicActionGroupRevertOptions
): Promise<AtomicActionGroupRevert> {
    return revertActionGroupsAtomically([groupId], options);
}
