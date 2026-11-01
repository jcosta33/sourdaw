# Lesson library: release and provenance drift

A change is incomplete when a tracked-set source edit, a script, literal or name edit, or a merge or exception edit
leaves a release digest or provenance record stale. Split out of `test-validity.md`.
Each probe answers the baseline question from the Review section of root `AGENTS.md` (what must break for this
check to fail, and does it observe what its name claims?) and carries its baseline mechanical probe unrestated:
revert the behavioral hunk or apply one targeted mutation, run the named spec, and a remaining green fails the
round. Run mutations only on a committed head through [reviewer isolation](README.md#reviewer-isolation).
Report a probe that cannot run with its exact mutation, named check and limitation, never as passed.

## Standing probes

The Release inventory step runs on every push. Inspect its result on the reviewed head; a pass on an
earlier head or a retry discharges nothing, and a missing restamp is the reviewer's finding.

1. **A tracked-set source edit leaves its digest stale.**
   Probe: for each surface boundary in `scripts/checkReleaseInventory.ts`, run
   `git diff --name-only <base> <head> -- <gitPathspecs>` with its `:(exclude…)` entries, matching only
   `gitPathspecs`, never the broader licensing `paths`. Any listed path requires
   `release/open-source-inventory.json` to move in the same diff; `pnpm release:restamp:tracked-set`
   refuses until the source change is committed.
   (#5568)

2. **A script, literal or name edit changes a provenance input.**
   Probe: every `package.json` edit moves the Cargo source pin in `scripts/dependencyLicenseReport.ts`,
   so the dependency restamp artifacts must move with it. Every new URL literal needs an
   external-reference assignment whose removal exposes the exact missing reference. Every new device
   type or registry name the mark census reports needs classification.
   (#5642, #5625, #3127, #5846)

3. **A merge or exception edit drops curated provenance.**
   Probe: when resolving shared inventory, keep the union of curated external-reference assignments and
   check the census against both sides of the merge. For a scanner ignore, run the pinned scanner on the
   exact original commit: a finding without the ignore, none with the audited fingerprint, one with a
   wrong fingerprint. Keep synthetic credential controls and evaluate every byte-exact reader of the
   configuration (`scripts/test-health-gate-scripts.sh`) unchanged.
   (#5851, #5746, #5748, #5846)
