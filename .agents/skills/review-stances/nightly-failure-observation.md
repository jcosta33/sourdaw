# Lesson library: nightly failure observation

Failure-mode stance for scheduled workflows where a reporter runs after the train. Derive and name
the input that can fail outside the jobs already visible to the reporter; do not dispatch this file
as a menu item.

## Standing probes

- Trace every report-producing job to the reporter's direct `needs`, its job-level condition, and
  the payload serialized from those dependencies. A failing job omitted from `needs` cannot make
  `failure()` true for that reporter and cannot appear in `toJSON(needs)`.
- Simulate one report-producing dependency failing while every other dependency succeeds. Execute
  the reporter's real extraction command with that payload and prove the failure name reaches the
  issue body; separately prove the reporter condition admits the scheduled run and excludes other
  events.

## Lessons from escapes

### 2026-10-07 — an isolated E2E report failure had no nightly observer (issue #5001)

PR #3119 established the reporter's exact `needs` coverage list before PR #3170 added the separate
`e2e-report` job that merges and uploads E2E artifacts. The later nightly split carried the list
forward without adding that job. As a result, a merge or upload failure after successful `e2e` was
outside both the reporter's `failure()` condition and its `toJSON(needs)` payload. This source trace
identifies the contract gap; it does not establish what any historical reviewer saw or concluded.

Probe: give the actual reporter command a payload whose only failed entry is `e2e-report`, run it
with issue creation stubbed, and require the body to name `e2e-report`. Also remove `e2e-report` from
the reporter's direct `needs` and require the workflow contract check to fail, while retaining the
scheduled-only condition and the deploy job's own dependency policy.
