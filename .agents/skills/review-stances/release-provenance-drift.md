# Lesson library: release and provenance drift

A change is incomplete when a script, literal or name edit, or a merge edit leaves a
release digest or provenance record stale. Split out of `test-validity.md`. Each probe answers the baseline
question from the Review section of root `AGENTS.md` (what must break for this check to fail, and does it observe
what its name claims?). The Release inventory step of the Types and contracts job runs on every non-draft push;
inspect its result on the reviewed head. A pass on an earlier head or a retry discharges nothing, and a stale digest or
provenance record that the diff should have moved is the reviewer's finding. Only the admitted Grand Boule DSP
source and ADR 0036 are content-pinned; an edit inside any other Grand Boule boundary needs no inventory edit. Report a probe that cannot run with its exact mutation, named check and
limitation, never as passed.

## Standing probes

1. **A content-pinned boundary edit leaves its digest stale, or a label-only edit moves the inventory
   (#5568, #6726).** In `GRAND_BOULE_RELEASE_REGISTRY` only boundaries with `pinsAdmittedBytes`
   (`grand-boule-native-rust`, `grand-boule-admission-decision`, per ADR 0036) record
   `tracked-set-sha256:<hex>:<label>`. Run `git diff --name-only <base> <head> -- <gitPathspecs>` for those
   two: any listed path requires `release/open-source-inventory.json` to move in the same diff
   (`pnpm release:restamp:tracked-set`). Every other boundary records `tracked-set:<label>`, so a diff touching
   only those files must leave the inventory untouched, while a diff that adds, removes, or renames a
   `digestLabel` must move those entries. The checker still refuses any boundary whose tracked set is empty,
   has a missing file, or has an unsafe (symlink, non-regular, or outside-repository) file; probe by emptying
   one pathspec or replacing a tracked file with a symlink and confirming `pnpm test:release-inventory`
   names it.
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
