# Standing probes: security and platform boundaries

Use this file for a stance that attacks native authority, renderer trust, platform capabilities, IPC exposure,
filesystem access, secrets, installer and scheduler integration, or the trust chain of a tool the repository
executes. Each probe names the failure, the PR, the input or state to drive, and the check that must go red.
Historical reviewer prompts and tiers are unestablished unless a probe says otherwise. Report the concrete break
or none.

## Standing probes

1. **Implicit authority roots must be app-owned all the way up (OS temp dir; introduced by PR #2 `eaf9b0687a`,
   retained by #3404, fixed by #3642).** `std::env::temp_dir()` was a built-in root although the same module
   defined `sourdaw_ipc` as Sourdaw's app-owned child, so an authorized renderer could read, list and write
   unrelated same-user temporary files. #3404 attacked grant and private-directory spellings but accepted the
   root list's description as ownership evidence. Enumerate every implicit authority root from the live
   implementation and prove why the application owns the whole root rather than an app-specific child. Create a
   synthetic ungranted sibling one component outside each owned child and drive every exposed read, list and
   write route; the sibling is refused without mutation while the owned child and an explicit recursive grant
   stay positive controls. Trace internal native scratch producers separately from renderer-reachable file
   commands: an internal consumer of a broad platform directory grants the renderer nothing over it.
2. **Canonical paths, not string prefixes.** Follow canonical paths through existing symlinks and missing tails
   before evaluating a root or grant; check component boundaries and platform spelling behavior.
3. **Managed-directory components are admitted before any child is created (installer, caught pre-delivery on
   #5869; not a `main` escape).** A symlinked `Library` or `LaunchAgents` could replace an unrelated external
   plist before launchd inspection. Require an existing canonical home anchor, refuse each parent alias without
   external child creation or scheduler calls, and preserve an external plist sentinel byte-for-byte; keep
   canonical directory creation and reinstallation as positive controls.
4. **A scheduler install must observe its first real launch (#5869).** The installer ended at
   `launchctl bootstrap` and `launchctl print`, which prove only registration. With the primary on an external
   volume, launchd refused the job before it ran (`Unable to open stdout path ... Operation not permitted`) and
   `print` showed a rising `runs` with `last exit code = 78: EX_CONFIG` at every interval while install reported
   success. Observe the first RunAtLoad launch (`runs`, `last exit code`) on the actual volume the job must write
   to, not a temporary directory. Stub `print` as `runs = 1` with `last exit code = 78: EX_CONFIG` and as
   `runs = 0` for the whole wait; require boot-out, plist removal and an error naming the pinned binary and
   remediation. Deleting the launch observation must fail both.
5. **Selection provenance must reach the byte consumer (issue #5767; `4f410257b212`, retained by #2 `4faaa241a461`
   and #2181).** A native-dialog rejection fallback returned browser `File.name` strings that the desktop
   consumer read as native paths (no associated PR). Separate mocked fallback-name and native-path checks stayed
   self-consistent. Reject the native opening, drive the real browser input with real Files, and read the
   returned bytes with the platform FileReader: require original File identity, contents, MIME type,
   `lastModified`, order and same-basename separation, with zero native path reads. Keep granted-native byte
   reads and cancellation controls, and require native byte-read failures to propagate without another picker.
   A handle-only consumer must refuse browser-only authority before registration, without exposing a path, File
   or raw error. Removing provenance dispatch or that refusal must redden the owning case. These probes
   establish neither OS-dialog execution nor a security exposure.
6. **Package-manager trust reaches the final caller (#4222 `120c9e2b418`, #5806; #5464 `eded998aebf`).** The setup
   action's bootstrap could block the selected JavaScript pnpm on unused native-engine signature metadata; the
   Corepack-producer and later Node/cache-consumer arrangement let a Corepack shim in the selected Node
   directory override an already verified target through the later PATH prepend. Public approval prose does not
   prove which probes ran. Follow the executing tool through acquisition, activation and its final consumer, and
   distinguish a reviewed bootstrap byte pin from runtime signature verification. Bind the selected engine's
   name, version and installed integrity to a trusted signature before activation, and verify any platform
   package it executes. Then prepend the later runtime's directory and prove the cache caller still resolves the
   authenticated target. Before disabling Corepack aliases, validate the whole affected set of leaf symlinks and
   real targets against that selected Node's official distribution; refuse unrecognized launchers without
   deleting recognized peers, and preserve Node, npm, npx, Yarn and unrelated files.
7. **Private install ownership omitted a cross-environment setting (PR #2 `10f24a6f03`, pinned pnpm 11.6;
   2026-10-29).** CI defaults an unset virtual-store setting to false but local freshness comparison sees unset,
   so ownership checks could accept an install that an ordinary local package command refused (no security
   exposure established). Run the real pinned runner on a private offline install under CI, then local and CI
   package commands using repository workspace policy. Lock and ownership metadata stay unchanged and the
   virtual tree stays checkout-private, while the shared download-cache policy and freshness checks remain.
   Removing the explicit `enableGlobalVirtualStore: false` pin must expose the same mismatch; a precheck bypass,
   metadata rewrite or different CI environment cannot carry the proof.
8. **Hosted WASM control and source revisions are not the same revision (#4057, 2026-09-09).** GitHub executes
   workflow YAML from the merge revision while the workflow may check out an older PR head lacking the helper;
   review inspected a same-head build and receipt path, not the control CLI against two pinned roots. Execute the
   real control helper against a distinct clean source Git root lacking both hosted helpers, with relevant and
   irrelevant source changes and divergent closure hashes and toolchain pins; invalid or dirty roots must fail
   before source-toolkit import. For return verification, plant a source-toolkit sentinel and prove the verifier
   only reads the clean source root and never imports it.
9. **ZIP fixture clock drift obscured the strict artifact boundary (#4057 `d608d165a49`, 2026-10-10).** The
   streamed-artifact case and ZIP artifact-return fixtures used fflate 0.8.3 without explicit `mtime`; the
   streamed local and central header writes and both `zipSync` writes per file call `wzh`, which reads a fresh
   `Date.now()`, and crossing a DOS two-second boundary changed the timestamp word so the strict parser refused
   the archive before its descriptor or artifact checks ran. Force actual streamed and `zipSync` fixtures across
   a two-second DOS boundary and inspect both timestamp byte fields; pin every ZIP fixture writer to one fixed
   `mtime` through the supported `zipSync` option and streamed-entry property. Keep local-central equality,
   streamed content acceptance, descriptor corruption refusal, and the bounds, CRC, path, file-set and
   encryption oracles. On the fixed head revert only `mtime` and require the forced-clock case to fail; never
   relax the parser. This proves boundary behavior, not the hosted failure's clock interval or frequency.
10. **A replacement PR left its public fixture in scanned history (#5746 `cc52a482abc4`, replacement #5748;
    2026-10-29).** The original commit quoted the RFC 6455 section 1.2 WebSocket nonce; #5748 composed it at
    runtime and excluded the commit from its PR range, but Nightly's `--all` scan still reached the retained
    original branch. The value is a published protocol example, not an issued credential. Read the exact
    historical finding and its public source, prove detection with the pinned scanner, then admit only that
    commit/path/rule/line fingerprint. A wrong fingerprint and independent synthetic credentials, including
    `gitleaks:allow`, must remain detected under the same trusted configuration and flags. A clean replacement
    diff does not establish a clean full-history scan.
11. **The PR security scan lacked its main comparison configurations (#3170, #4854; 2026-10-28).** #3170 moved
    the main CodeQL producer from Health gates to Nightly, leaving the older main configuration in analysis
    history; #4854 later added a PR scan under Health gates' default identity, distinct from Nightly's main
    category. Successful scans and Gate did not prove every main configuration was compared. Paginate all main
    analysis configurations, not just the newest results, and compare their identities, scan scope and the
    hosted PR summary with actual uploads. Before any authorized retirement inspect alert continuity and the
    documented deletion and historical-data consequences. Mutate or omit the PR category and require the
    independent contract to fail after re-recording the workflow snapshot.
12. **Accepted NAM dimensions exceeded the runtime input width (#5209 `54ff77cd1f`, 2026-10-27).** The LSTM loader
    sized deeper cells to `hidden_size` while rendering passed a one-element input to every cell. The source
    establishes the length contradiction for `num_layers > 1 && hidden_size > 1`; no trap on the introducing head
    was measured, and the missing obligation was the layer/width cross-product. Pass the exact-layout,
    finite-weight two-layer, hidden-size-2 file (`num_layers` 2, `hidden_size` 2, 83 zero weights) through the
    public import boundary and the actual loader and prewarm entry (`GrinderEngine::load_neural_model`) on the
    rebuilt WASM bytes. Require a named refusal before construction or prewarm, with no model loaded, paired with
    successful controls: the single-layer wide `lstm.nam` (hidden 3) and the stacked hidden-size-1 file. Count
    initial hidden and cell state and the head in the fixture (per layer `4h(in + h) + 6h`, plus `h + 1`) rather
    than guessing its length. A validated metadata object alone cannot prove runtime admission. Existing cases
    are partial coverage only: `validateGrinderNamModel.spec.ts` is metadata-only, and
    `grinder_stacked_lstm_rejection.rs` checks the refusal text and that no model loaded.
13. **Control receipt admission must precede semantic authority (#4128 `1d1471216e`).** The parser advanced
    interpretation after bounding its receipt without checking whether bounding had replaced success with
    failure, so staged authority survived an unadmitted control; schema-valid selector arguments hid it.
    Promote authority only after the actual bounded success receipt passes every carrier and byte admission. A
    compacted carrier, a failed receipt, or an oversized raw control cannot substitute for that witness: discard
    unadmitted staged intent and keep effectful schemas and calls closed. Select an otherwise-valid control from
    the actual published catalog, then drive effectful use through the real parser and the correction route;
    require no continuation, escaped authority or proposal, and the correlated failure preserved. Keep genuine
    in-budget local and hosted controls that restore the full effectful contracts. In a committed isolated
    probe, remove only the responsible discard or admission edge and require the `metricIntent.spec.ts` case
    "does not let the actual %s carry failed control authority into a following proposal" to fail independently
    of manifest pins. That case, "retains a genuine in-budget control and projects only the %s receipt copy" and
    "publishes complete semantic intake and safe reads before restoring exact effectful contracts after success"
    are partial coverage: none asserts the compacted-carrier input.

## Relocated

- Lane removal and merged-lane cleanup (#1802), merge-state landed proof, historical parent substitution
  (#5615, #5627), dependency authority movement, split PR metadata (#2357/#4420), acknowledged marker
  vanishing (#5639), `baseRef`/`baseRefOid` field requirements, registered provenance source identity, and the
  GitHub Actor `id` schema (#5705) → `closure-authority-proof.md`.
- Darwin and Linux storage census, `LINK` type, pathname diagnostics, capped catalogs, start-time excuse,
  foreign same-UID attribution, temporary-storage ownership, hosted test isolation, and process-group
  inspection EPERM (#5274, #5331, #5345, #5443, #4899, #5240) → `guard-reclamation-proof.md`.
- Delivery authority from an earlier PR state (#4586, #5032), the old-receipt publication bypass (#5111) and
  the reviewer confirm token permission (#4411) → `review-authorization.md`.
- Repair ancestry against the finding revision (#4411) → `public-repair-records.md`.
- A new fenced command reaching the trusted launcher (#5639) → `trusted-script-delivery.md` probe 1.

## Retired lessons

- A declared Body choice never entered the worklet schema (#5254) → enforced by
  `src/modules/AudioEngine/worklets/__tests__/bacteriaProcessor.spec.ts` "delivers every band Body value admitted
  by the production schema to the engine" and `src/modules/AudioEngine/engine/__tests__/BacteriaNode.spec.ts`
  "forwards every band Body choice through its immutable production target without widening admission".
- MIDI Learn armed without an available input route (`4f410257b2`) → enforced by
  `src/modules/ControlSurface/useCases/midiLearn/__tests__/startMidiLearn.spec.ts` "refuses an unsupported route
  before replacing an armed target or scheduling another timeout" and
  `src/modules/ControlSurface/useCases/__tests__/midiLearn.spec.ts` "should not start learning when MIDI input is
  unsupported".
