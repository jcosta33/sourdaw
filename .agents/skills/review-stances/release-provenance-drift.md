# Lesson library: release and provenance drift

A change is incomplete when a tracked-set source edit, a script, literal or name edit, or a merge edit leaves a
release digest or provenance record stale. Split out of `test-validity.md`. Each probe answers the baseline
question from the Review section of root `AGENTS.md` (what must break for this check to fail, and does it observe
what its name claims?). The Release inventory step of the Types and contracts job runs on every non-draft push;
inspect its result on the reviewed head. A pass on an earlier head or a retry discharges nothing, and a missing
restamp is the reviewer's finding. Report a probe that cannot run with its exact mutation, named check and
limitation, never as passed.

## Standing probes

1. **A tracked-set source edit leaves its digest stale (#5568).** For each surface boundary in
   `scripts/checkReleaseInventory.ts`, run `git diff --name-only <base> <head> -- <gitPathspecs>` with its
   `:(exclude…)` entries, matching only `gitPathspecs`, never the broader licensing `paths`. Any listed path
   requires `release/open-source-inventory.json` to move in the same diff; the author's
   `pnpm release:restamp:tracked-set` refuses until the source change is committed.
2. **A `package.json` edit moves the Cargo source pin (#5642).** `scripts/dependencyLicenseReport.ts` digests
   `package.json` into its Cargo source pin, so every `package.json` edit must move the dependency restamp
   artifacts under `release/` in the same diff. Read the diff for both; one without the other is the finding.
3. **A new URL literal lacks its external-reference assignment (#3127, #5625).** Runs: CI; the reviewer reads the
   Release inventory step on the head. Every new URL literal needs an external-reference assignment in the
   `externalReferences` list of `release/open-source-inventory.json`; the reviewer lists URL literals the diff adds and checks each has one at
   the fixed commit. The author confirms that removing one assignment makes `pnpm test:release-inventory` name the
   exact missing reference.
4. **A new device type or registry name escapes the mark census (#5846).** Runs: CI; the reviewer reads the
   Release inventory step on the head. Every new device type or registry name the mark census reports needs
   classification; the reviewer lists types and registry names the diff adds and checks each is classified at the
   fixed commit.
5. **A merge resolution drops curated provenance (#5846, #5851).** Runs: CI; the reviewer reads the Release
   inventory step on the merge head. When resolving shared inventory, keep the union of curated external-reference
   assignments: compare the resolved file's assignments with both merge parents (`git show <parent>:<path>`) and
   require every assignment either side carried to survive, and the census to pass against the merged tree.

## Relocated

- A scanner exception that admits more than its audited finding (#5746, #5748) → `security-and-platform.md`
  probe 10.
