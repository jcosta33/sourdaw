# Lesson library: lifecycle control routing

A control whose label and action depend on a multi-state lifecycle must choose both from the same
state. Deriving the label from the status and the action from a coarser flag lets them disagree.
A cancel must return the lifecycle to the state the cancelled operation replaced, never to a fixed
initial state.

## 2026-10-31 — Update Freeze unfroze a stale track (PR #5912)

Commit `b4da902197f2c4853ef1a74b7d74ffd1cfebdac2` labelled the track menu's freeze item
`Update Freeze` when `freezeState.status` was `stale`, while its action still branched on
`track.frozen`. A stale track keeps `frozen: true`, so choosing Update Freeze dispatched
`unfreezeTrack` and discarded the take the user asked to refresh. GitHub associates no pull request
with the commit; its historical review stances and tiers are not established. The menu spec pinned
only the frozen and unfrozen statuses.

The repair in PR #5912 exposed two more defects of the same class:

- A refresh keeps `frozen: true` while it renders. A label chosen from `frozen` therefore offered
  Unfreeze during the render. `unfreezeTrack` does not stop the render, which later re-froze the
  track the user had just unfrozen.
- Cancelling a refresh wrote status `unfrozen` and left `frozen` and the old buffer in place.
  Unfreeze then returned early on that status, so no control could leave the state.

The blind spot was the state space, not any single branch. Each control was reviewed against the
states its spec named. Nobody enumerated the reachable combinations of the boolean and the status.

Probes:

- List every reachable pair of the coarse flag and the lifecycle status, including the transient
  states an operation writes before it settles (`freezing` with either flag, `error` with either
  flag). For each pair, assert the label and the dispatched action in every control that offers
  them; the track menu and the Inspector are separate routes.
- Narrow each routing branch to a single status, for example `frozen && !stale` to
  `status === 'frozen'`. Some per-state case must fail.
- Cancel an operation that replaced a settled state, at each await it crosses. Assert the full prior
  state returns: flag, status, and every field the status carries. Cancel the first run from an
  initial state, and assert the flag as well as the status.
- For a cancel that lands after the operation's last await, prove through the registered action
  pipeline that the aborted transaction restores the prior state. A unit test with a mocked
  repository cannot show the rollback.
