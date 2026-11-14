# Standing probes: security and platform boundaries

Use this file for a stance that attacks native authority, renderer trust, platform capabilities, IPC exposure,
filesystem access, secrets, installer and scheduler integration, or the trust chain of a tool the repository
executes. Each probe names the failure, the input or state to drive, and the check that must go red. Historical
reviewer prompts and tiers are unestablished unless a probe says otherwise. Report the concrete break or none.

## Standing probes

1. **Implicit authority roots must be app-owned all the way up (#3642).** `std::env::temp_dir()` was a built-in
   root although `crates/sourdaw-native/src/commands/filesystem/mod.rs` defined `sourdaw_ipc` as Sourdaw's
   app-owned child, so an authorized renderer could read, list and write unrelated same-user temporary files; a
   review that attacked grant and private-directory spellings accepted the root list's description as ownership
   evidence. Enumerate every implicit authority root from the live implementation and prove why the application
   owns the whole root rather than an app-specific child. Create a synthetic ungranted sibling one component
   outside each owned child and drive every exposed read, list and write route; the sibling is refused without
   mutation while the owned child and an explicit recursive grant stay positive controls. Trace internal native
   scratch producers separately from renderer-reachable file commands: an internal consumer of a broad platform
   directory grants the renderer nothing over it. Run
   `pnpm guard --profile focused -- pnpm cargo:test --package sourdaw-native renderer_temp_authority_requires_owned_scratch_or_explicit_grant`
   after re-adding the broad root.
2. **Canonical paths, not string prefixes.** Follow canonical paths through existing symlinks and missing tails
   before evaluating a root or grant; check component boundaries and platform spelling behavior. A sibling whose
   name extends an owned root's final component (`<root>-other`) must refuse; a prefix comparison admits it.
3. **Every managed home path component is admitted before creating its child (#5869).** A symlinked `Library` or
   `LaunchAgents` could replace an unrelated external plist. The same attack at `Logs`, `Sourdaw`, or
   `lane-cleanup` could redirect launchd's stdout or stderr to foreign data. Require an existing canonical home
   anchor, refuse each component alias before creating a child beneath it or scheduling, and preserve the foreign
   sentinel byte-for-byte. Refuse symlinked and hardlinked files at the new home log targets, while
   retaining ordinary one-link files there. Old primary logs are unused; leave them untouched and do not gate
   installation on their file type or link count. Removing a current-path refusal must fail
   `scripts/__tests__/installCleanupLanes.spec.ts` at the matching alias case; restoring the old-path gate must
   fail its "leaves obsolete primary" cases.
4. **The first launch must exercise launchd's pre-exec paths (#5869, #5940).** Runs: orchestrator. `launchctl bootstrap` and
   `launchctl print` prove registration; even a counted run may end at `78: EX_CONFIG` before Node executes.
   On an external primary, launchd's working directory and stdout/stderr formerly pointed there; the system log
   showed `Unable to open stdout path ... Operation not permitted`, with no worker log. A fixture whose home and
   primary are the same path cannot detect that boundary. Use distinct canonical paths and require the plist's
   working directory and log paths under home, with the verified runtime still reading and running against the
   primary. Reverting those plist paths must fail `scripts/__tests__/installCleanupLanes.spec.ts` "installs and
   reinstalls a launchd job". Stub `print` as `runs = 1`, `last exit code = 78: EX_CONFIG` and as `runs = 0`
   throughout the wait; both must boot out, restore or remove the plist, and direct diagnosis to launchctl/system
   logs and the home worker log. Recommend Node privacy access only for an identified macOS privacy denial of
   that pinned binary, never from 78 or a generic worker error alone. The stub proves rollback and diagnostics,
   not actual macOS launch success; after delivery, observe the
   installed job's first launch on the target machine.
5. **Selection provenance must reach the byte consumer (issue #5767).** A native-dialog rejection fallback
   returned browser `File.name` strings that the desktop consumer read as native paths; separate mocked
   fallback-name and native-path checks stayed self-consistent. Reject the native opening, drive the real browser
   input with real Files, and read the returned bytes with the platform FileReader: require original File
   identity, contents, MIME type, `lastModified`, order and same-basename separation, with zero native path reads.
   Keep granted-native byte reads and cancellation controls, and require native byte-read failures to propagate
   without another picker. A handle-only consumer must refuse browser-only authority before registration, without
   exposing a path, File or raw error. Removing provenance dispatch or that refusal must redden
   `src/modules/Project/repositories/nativeFileDialog/__tests__/browserFallback.integration.spec.ts`. These probes
   establish neither OS-dialog execution nor a security exposure.
6. **Package-manager trust reaches the final caller (#4222, #5806, #5464).** The setup action's bootstrap could
   block the selected JavaScript pnpm on unused native-engine signature metadata, and a Corepack shim in the
   selected Node directory could override an already verified target through a later PATH prepend. Public approval
   prose does not prove which probes ran. Follow the executing tool through acquisition, activation and its final
   consumer, and distinguish a reviewed bootstrap byte pin from runtime signature verification. Bind the selected
   engine's name, version and installed integrity to a trusted signature before activation, and verify any
   platform package it executes. Then prepend the later runtime's directory and prove the cache caller still
   resolves the authenticated target. Before disabling Corepack aliases, validate the whole affected set of leaf
   symlinks and real targets against that selected Node's official distribution; refuse unrecognized launchers
   without deleting recognized peers, and preserve Node, npm, npx, Yarn and unrelated files. Removing the shim
   cleanup or the foreign-launcher refusal must fail `scripts/__tests__/setupPnpm.spec.ts`.
7. **Private install ownership must not omit a cross-environment setting.** Runs: author. CI defaults an unset
   virtual-store setting to false while local freshness comparison sees it unset, so ownership checks could accept
   an install that an ordinary local package command refused (no security exposure established). The author runs
   the real package manager on a private offline install under CI, then local and CI package commands using
   repository workspace policy: lock and ownership metadata stay unchanged and the virtual tree stays
   checkout-private, while the shared download-cache policy and freshness checks remain. Removing the explicit
   `enableGlobalVirtualStore: false` pin must expose the same mismatch; a precheck bypass, metadata rewrite or
   different CI environment cannot carry the proof. The reviewer confirms the pin in `pnpm-workspace.yaml` at the
   fixed commit and that `scripts/__tests__/pnpmModulesPreflight.spec.ts` still reads it.
8. **Hosted WASM control and source revisions are not the same revision (#4057).** GitHub executes workflow YAML
   from the merge revision while the workflow may check out an older PR head lacking the helper; a same-head build
   and receipt path does not exercise the control CLI against two roots. Execute the real control helper against a
   distinct clean source Git root lacking both hosted helpers, with relevant and irrelevant source changes and
   divergent closure hashes and toolchain pins; invalid or dirty roots must fail before source-toolkit import. For
   return verification, plant a source-toolkit sentinel and prove the verifier only reads the clean source root
   and never imports it. Importing from the source root must fail `scripts/__tests__/hostedWasmSourceContext.spec.ts`.
   The optimizer assumption introduced in #3018 and carried by #6380 also requires the actual source build
   route: wasm-pack accepts PATH before its hard-coded fallback, so a CLI pin or version echo does not pin
   Binaryen. Verify the official archive digest before extraction, reject escaping/link members, authenticate
   extracted executable bytes and observe its runtime version before and after the build. Substitute an
   executable that prints version 133 but has different bytes, and require `binaryenBuild.spec.ts` to fail.
   Exercise all four package wrappers; keep the hosted decoder admission refusal. Existing control code hashes
   the source-produced manifest, but its older Toolchain receipt does not independently attest optimizer fields.
   Historical reviewer draws were not reconstructed; these are observed acquisition/provenance gaps.
9. **ZIP fixture clock drift obscures the strict artifact boundary (#4057, #5308).** A ZIP writer without an
   explicit `mtime` stamps each local and central header from a fresh clock read, so crossing a DOS two-second
   boundary between those writes changes the timestamp word and the strict parser refuses the archive before its
   descriptor or artifact checks run. Force actual streamed and `zipSync` fixtures across a two-second DOS
   boundary and inspect both timestamp byte fields (time and date); pin every ZIP fixture writer to one fixed
   `mtime` through the supported `zipSync` option and streamed-entry property. Keep local-central equality,
   streamed content acceptance, descriptor corruption refusal, and the bounds, CRC, path, file-set and encryption
   oracles. Every writer pins it, including those in `scripts/__tests__/codeqlNightlyEvidence.spec.ts` and
   `scripts/__tests__/hostedWasmArtifacts.spec.ts`. On the fixed head revert only the `mtime` option and require
   the codeqlNightlyEvidence case "keeps a valid evidence fixture readable across a forced DOS timestamp boundary"
   to fail; never relax the parser. This proves boundary behavior, not a hosted failure's clock interval or frequency.
10. **A scanner exception admits only its audited finding (#5746, #5748).** Runs: author. A replacement PR that
    composes a public protocol fixture at runtime and excludes the original commit from its range still leaves
    that commit reachable from a retained branch, so the nightly full-history scan reports it; a clean
    replacement diff does not establish a clean full-history scan. The value was the RFC 6455 section 1.2 example
    nonce, a published protocol example, not an issued credential. The author reads the exact historical finding
    and its public source, runs the pinned scanner on the exact original commit (a finding without the ignore,
    none with the audited fingerprint, one with a wrong fingerprint) and keeps independent synthetic credential
    controls, including `gitleaks:allow`, detected under the same trusted configuration and flags. The reviewer
    checks at the fixed commit that `.gitleaksignore` gains only that commit/path/rule/line fingerprint, that
    `.gitleaks.toml` gains no path or rule allowlist, and that every byte-exact reader of the configuration
    (`scripts/test-health-gate-scripts.sh`) is unchanged.
11. **The PR security scan must cover every main comparison configuration (#3170, #4854).** Runs: author. Moving
    the main CodeQL producer between workflows leaves the older main configuration in analysis history, and a PR
    scan under one workflow's default identity is distinct from another workflow's main category; successful
    scans and Gate do not prove every main configuration was compared. The reviewer paginates all main analysis
    configurations with read-only `gh api repos/:owner/:repo/code-scanning/analyses`, not just the newest results,
    and compares their identities and scan scope with the `category` the `health-gates.yml` analysis step uploads
    and the hosted PR summary. Before any authorized retirement inspect alert continuity and the documented
    deletion and historical-data consequences. The author mutates or omits the PR category, re-records the
    workflow snapshot with `pnpm test:health-gates:record`, and requires `pnpm test:health-gates` to fail.
12. **Accepted NAM dimensions must not exceed the runtime input width (#5209).** Runs: author. The LSTM loader
    sized deeper cells to `hidden_size` while rendering passed a one-element input to every cell, a contradiction
    for `num_layers > 1 && hidden_size > 1`; the missing obligation was the layer/width cross-product. The author
    passes an exact-layout, finite-weight file with `num_layers` 2 and `hidden_size` 2 through the public import
    boundary and the actual loader and prewarm entry (`GrinderEngine::load_neural_model`) on rebuilt WASM bytes,
    requiring a named refusal before construction or prewarm with no model loaded, paired with successful controls:
    the single-layer wide `crates/daw-dsp/src/grinder/nam/fixtures/lstm.nam` and a stacked hidden-size-1 file.
    Derive the fixture length from the layout (per layer `4h(in + h) + 6h` including initial hidden and cell
    state, plus `h + 1` for the head) rather than guessing it. A validated metadata object alone cannot prove
    runtime admission. The reviewer removes the cross-product refusal and runs
    `pnpm guard --profile focused -- pnpm cargo:test --package daw-dsp stacked_wide_lstm_is_rejected`, whose case in
    `crates/daw-dsp/tests/grinder_stacked_lstm_rejection.rs` checks the refusal text and that no model loaded; `src/modules/Grinder/services/__tests__/validateGrinderNamModel.spec.ts`
    is metadata-only partial coverage.
13. **Packaged native identity must follow the builder target (#2203, #3499).** The build used Cargo's host target
    and copied fixed artifact names; string or script-presence checks did not establish the packed OS, CPU or
    binary kind. Replace either actual packaged addon or helper with another OS/CPU image, an executable in place
    of the addon, a shared library in place of the helper, or a truncated header/table. Require a named
    artifact/target refusal before fuse mutation, while matching images retain legal-file and fuse readback
    checks. Removing native admission from `afterPack` must redden `scripts/__tests__/desktopPackaging.spec.ts`;
    removing identity/kind/bounds checks must redden `scripts/__tests__/verifyPackagedNativeArtifacts.spec.ts`.
    Header fixtures prove neither platform build provenance nor installed-package/native-ABI compatibility.
    Attack the producer independently: set `CARGO_BUILD_TARGET` to Cargo's reported host and use a relative or
    absolute output root containing spaces. Both builds must command that concrete host and explicit directories,
    then stage bytes only from those target-specific paths. A conflicting environment target must fail before
    compilation; configuration defaults must be overridden by the explicit flags. Removing either build's
    `--target` or `--target-dir`, reverting its source path to a guessed `release` directory, letting a failed
    Cargo process stage an existing artifact, or disconnecting the CLI runner must redden
    `scripts/__tests__/buildNativeAddon.spec.ts`. Its filesystem and subprocess-boundary doubles do not prove
    actual cross-platform compilation or loadability.
14. **A MIDI permission denial is not absent capability.** Runs: author. Capability to request access and
    permission to enumerate are distinct: treating a denial as absent capability removes the recovery route. The
    author drives a real browser-capability snapshot with the API present and its first request denied: a truthful
    error, supported state, accessible Refresh and footer error; remount without another request, then grant
    access and activate Refresh, requiring exactly one new request, actual enumerated and selected input, and
    cleared error in both views. Pair this with an absent-API browser that makes no request and remains
    unsupported, plus native fallback and stale-generation controls. The reviewer reads
    `src/modules/MIDI/repositories/webMidi/lifecycle/initWebMidi.ts` and `src/utils/platformCapabilities.ts` at the
    fixed commit for a denial path that keeps the supported state, and runs
    `src/utils/__tests__/platformCapabilities.spec.ts` after collapsing denial into unsupported. These checks do not
    establish physical-controller acceptance.

15. **Retained legal bytes never grant source authority (#2731).** A complete MIT license beside a
    git-sourced runtime Cargo package must still fail actual installed-metadata artifact generation.
    In `dependencyLicenseReport.installedSources.spec.ts`, remove source authentication before the
    retained-legal fast path and require the git-source case to fail. Preserve actual-checksum
    registry and registered null-source positives, plus unregistered path and offline git negatives.
    The original archive-fallback case never entered this admitting route; historical review
    model, tier and prompt are not established.

## Retired lessons

- A declared Body choice never entered the worklet schema (#5254) → enforced by
  `src/modules/AudioEngine/worklets/__tests__/bacteriaProcessor.spec.ts` "delivers every band Body value admitted
  by the production schema to the engine" and `src/modules/AudioEngine/engine/__tests__/BacteriaNode.spec.ts`
  "forwards every band Body choice through its immutable production target without widening admission".
- MIDI Learn armed without an available input route → enforced by
  `src/modules/ControlSurface/useCases/midiLearn/__tests__/startMidiLearn.spec.ts` "refuses an unsupported route
  before replacing an armed target or scheduling another timeout" and
  `src/modules/ControlSurface/useCases/__tests__/midiLearn.spec.ts` "should not start learning when MIDI input is
  unsupported".

## Relocated

- Lane removal and merged-lane cleanup (#1802), merge-state landed proof, historical parent substitution
  (#5615, #5627), dependency authority movement, split PR metadata (#2357/#4420), acknowledged marker
  vanishing (#5639), `baseRef`/`baseRefOid` field requirements, registered provenance source identity, and the
  GitHub Actor `id` schema (#5705) → `closure-authority-proof.md` probes 1 to 10.
- Darwin and Linux storage census, `LINK` type, pathname diagnostics, capped catalogs, start-time excuse,
  foreign same-UID attribution, temporary-storage ownership, hosted test isolation, and process-group
  inspection EPERM (#5274, #5331, #5345, #5443, #4899, #5240) → `guard-reclamation-proof.md` probes 1 to 11.
- Delivery authority from an earlier PR state (#4586, #5032), the old-receipt publication bypass (#5111) and
  the reviewer confirm token permission (#4411) → `review-authorization.md` probes 10, 7 and 11.
- Repair ancestry against the finding revision (#4411) → `public-repair-records.md` probe 11.
- A new fenced command reaching the trusted launcher (#5639) → `trusted-script-delivery.md` probe 1.
- Control receipt admission before semantic authority (#4128) → `ai-request-authority.md` probe 10.
