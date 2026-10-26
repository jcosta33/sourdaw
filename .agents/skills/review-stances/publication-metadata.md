# Publication metadata from inherited history

Native publication metadata must describe the lane's own work. For a stacked lane, exclude every
commit reached by resolved main and parent heads when deriving a title; a squash-landed parent
leaves its original commits reachable from the child but absent from main. Explicit title changes
must pass the same owned-lane boundary and drive body validation, derived labels and projects, and
type warnings from the title GitHub will show. A default republish preserves the existing title.

Use real Git history with a child commit followed by a later-dated parent repair, then synchronize
the parent and its squash landing into the child. Assert the native creation title names the child.
As the counterfactual probe, remove the parent-head exclusion: the same named spec must select the
parent repair and fail. Also observe the actual authenticated edit arguments for an explicit title
correction and the absence of a title argument on a default update.

Escape: [#5701](https://github.com/jcosta33/sourdaw/pull/5701) inherited its parent's
`fix(review): pass resolver fixture paths as process data` title after synchronization.
[Stack support #4252](https://github.com/jcosta33/sourdaw/pull/4252) introduced the context where
retained parent commits could enter the title range without their exclusion.
[Helper history #2746](https://github.com/jcosta33/sourdaw/pull/2746) pinned an already-existing
main-only range; it did not introduce the stack semantics. The missing proof was a real late-parent
history and its exclusion-removal probe. The historical reviewer stance and tier are unavailable.
