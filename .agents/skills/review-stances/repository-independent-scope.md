# Lesson library: unnecessary repository I/O in scope decisions

### 2026-10-28 — a clone blocked an API-only scope decision

PR #2700 (`933159de5caa1801a37a7b435e39a0fb34d20e7d`) put checkout before
changed-path filtering on pull requests. PR #3119 moved it into reusable validation,
whose callers supplied pull-request events and read tokens. Its public reviews attacked
gate topology, permissions and assertion coverage; the historical private prompts and
tiers are unestablished. The missing failure mode was repository acquisition failing
before a decision that needs only the changed-files API. PR #5818's run 40751724067
cancelled during that fetch before filtering; the underlying fetch latency is unproven.

Enumerate every reusable-workflow caller and its event and effective permissions.
Trace the pinned action's token, inline configuration, pagination and cleanup routes.
Execute the actual filter entry with mocked API pages and renamed files in an empty
directory while denying subprocesses and network. Execute the inline resolver there
too. Reintroducing checkout must fail the named repository-independence contract;
missing verdicts and failed or skipped selected jobs must still fail the aggregates.
