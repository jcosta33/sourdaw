# Git notes preimage preservation

A forced fetch can replace a local notes history that is not an ancestor of the remote. Check
reachability of the exact observed local commit and its unique note blob after the actual fetch,
not just the refspec or the later non-forced push. Use a disposable bare remote with independent
local and remote notes histories; also probe refusal before fetch when inspection or create-only
recovery pinning fails. A recovery ref preserves an observation, not concurrent writers or a union.

PR #4271 introduced the forced notes refresh; its review examined head refspecs, git-ai flags and
mutation sensitivity, but did not exercise preservation of a divergent local notes tree. A local
preimage was later observed absent from the refreshed notes history; the concurrent action that
caused that particular replacement was not established.
