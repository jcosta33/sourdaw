# Standing probes: strip, device, engine and settlement lifetimes

Defects where a strip, device, engine graph, preview source, credential session or settled task is replaced, reset,
disposed or cancelled while a continuation, callback or cached reference still acts for the outgoing instance, and
where a lifecycle control reads its label and its action from different states or cancels to a fixed state instead
of the one the cancelled operation replaced. Split out of `session-lifecycle.md`.
Each probe names the failure mode, the input or state to drive and the check that must go red, and names the
mutation that must fail it where its source lesson established one. Controlled ports (media, graph, scheduler,
wall-clock) prove ordering, ownership and cleanup; they never establish physical hardware audibility.

## Standing probes

1. **Unmount is a Connect gesture (#3226).** #3226 put a 15 s probe between opening a credential session and
   `replace_runtime`. Overlap looked unreachable because `configurationPending` disables the button, but `AiSection`
   unmounts when Preferences leaves AI (`section === 'ai' ? <AiSection /> : null`), which drops the flag, so a second
   Connect starts while the first probe is alive and the first then overwrites the second. A pending flag on a
   conditionally mounted surface is not a lifecycle lock. For any change that puts a network or IPC wait between
   opening a session and installing it, walk Connect, leave the section and return, Connect again before the first
   wait settles, and name which runtime is installed; the first one is the finding.
2. **Cold strip: live eligibility is not an initialized strip (#2035, #2083).** #2035 built runtime topology for
   every project device and #2083 excluded Yeast but left scheduler synth and drum devices in the Web Audio chain
   projection, so a MIDI track carries valid project instruments with no Web Audio node beside a node-backed effect;
   #2083 also made device edits require an exact live before-chain, and MIDI import publishes the track with its
   default Synth after boot's strip projection, so a lawful Remove Synth before first Play committed project truth
   and then failed against an absent strip (Play/Stop warming masked it). Drive the real import, Command/CRDT/history
   and engine boundary with a completed import, an actually absent strip and no Play gesture, and a cold plus an
   already initialized strip holding a MIDI synth or drum and an effect: real add, Undo and Redo keep project and
   native snapshots at the complete instrument and effect identities while Web Audio initializes or reconciles only
   node-backed members; an instrument-only edit preserves full native truth; Undo changes the existing live chain
   instead of sending an initialization snapshot only a matching strip accepts. Cover cold add/remove/reorder and
   grouped final-chain composition. Controls that must still refuse: unknown device types (visible for ordinary
   construction refusal), an existing mismatched strip, stale or unrelated project divergence, duplicate ownership;
   inject initialization rejection and require committed failure with no later parameter writes. Remove the
   projection or the missing-strip admission and the cold Command regression must fail. The UI case requires the
   Remove Synth control unconditionally and clicks it before first Play.
3. **Settlement needs the current attempt, root and incarnation.** A continuation admitted by track ID, device ID or
   reused project timestamp alone can publish into a successor. Hold the continuation and replace what it belongs to:
    - Failed Freeze settlement (#2597): the failure settlement after the render refuses must still belong to the exact
      project root, revision, task and freeze aggregate when admitted and immediately before commit, and an old
      attempt must not clear a newer task in its finalizer. Hold settlement admission and, separately, its staged-write
      commit boundary; cancel, start a newer task, replace the root with the same timestamp and track ID,
      remove/recreate the track, or replace its take: the successor survives with no failed-Freeze history. Pair each
      refusal with a genuinely current retry that persists its reason and later freezes, undoes and redoes normally.
      Drive the real Command/durable-state route, never a direct use-case callback.
    - Crumbs waveform work (#5041, #5780): hold telemetry and peaks through the app-injected owner reader; replace an
      identical-ID root, and remove/restore the same device object while its preceding view is still present. Observe
      every committed owner transition before coalescing reconciliation so absence/type/owner/duplicate ABA cannot
      revive an old token. Do not start a newer load or replace the sample leaf before the refusal assertion (those
      guards hide a missing fence). Real ordinary parameter writes and fresh successor loads stay controls. Remove the
      synchronous owner refresh and the unchanged ABA case must fail. This proves display authority only.
    - Elastic (`33a3549990c5`): change sensitivity on varied-pulse audio, await the actual detection and owner
      projection, and require count, drawing and marker hit-testing to update without a pointer refresh; switch clips
      and check the current clip's projection, retained lock, an unrelated clip and PCM. A subscription rollback must
      fail the real-store case (no Worker or performance claim). The initial target mismatch was hidden by explicitly
      opening every sensitivity fixture. Hold the real debounce across selection A, B, A, explicit editor close/reopen,
      source replacement and same-ID root replacement: the old gesture leaves native rows and PCM exact, settles its
      callers and releases listeners; only a fresh gesture may act on the new owner; an unrelated selection must not
      override an explicitly opened target. Removing pending-owner invalidation must fail real raw-state controls,
      not a cancellation flag.
4. **Shutdown reclamation needs a release inside the poll pass (#2976, #5064).** The native CI failure on #5064
   came after the stop and destroy assertions passed: the whole-cascade wall-clock assertion read 252.790917 ms
   against 250 ms, which names no cascade step. Pin the scheduler-release transition itself: keep an extra runtime
   owner through the first retirement sweep, release it inside the first 2 ms poll callback, and require the next
   sweep to destroy it before another wait. Independently hold the owner across a synthetic wait longer than the
   500 ms budget and require a retained, named abandonment with no second poll.
5. **Init fault announces a healthy engine (Levain, #5227).** `90bc7995e44e` added the buffered pre-init loop; #946
   gave live handlers bank-local rejection while buffered replay escaped init's outer catch; #5587 repaired
   bank-local replay but a failed engine creation could still post `ready` on a later init while retaining its
   terminal fault, and no case counted a repeated `disposed` reply. Drive the raw port through a failed init,
   another init, a bank start and a release: the original error each time, no engine creation, replay or healthy
   ready, no rendered block. A fresh processor's successful init and bank-local replay still work. Dispose the same
   processor twice: two replies and a completed paced drain. Refusing a second init must not alter the shipped
   node's first-init readiness or the owner/follower bank lifecycle. Remove the terminal init refusal and the
   repeated-dispose answer separately; each unchanged named regression must fail.
6. **Unsupported NAM replacement must preserve the sounding model (#5209).** #5209 introduced the real NAM runtime
   with an admitted stacked-wide LSTM shape whose deeper input width contradicts its render buffer. Activate Capture
   mode and advance two identical loaded engines with identical input; attempt the unsupported replacement on one
   only; its subsequent PCM must equal the continuing reference with no reset, and be nonzero and separated from a
   matched unloaded/dry control (`has_loaded_neural_model` plus finite output passes while Circuit mode bypasses the
   capture). Pair empty-engine refusal with both supported topology boundaries and keep the selected library entry
   at the real import UI. Proves the shared/WASM route, not native transport or physical playback.
7. **Cached preview sources outlive their engine graph (`454de02a76`, #187).** Stop stopped the UI-owned preview
   source and natural completion cleared UI state, with no disconnect or engine-lifetime cleanup; #187 moved it into
   AudioEngine's cached preview helper. Start a cached preview through its real owner, then reset or dispose the
   engine: the source stops and disconnects before the outgoing graph retires, one completion notification, no
   admission against the outgoing lifetime. Start a successor during an old callback and deliver the old completion
   and release afterward; the successor survives. Pair nested reset, cleanup failure and disposed-engine refusal
   with ordinary previews that still coexist. Removing reset invalidation or the disposed-owner guard must fail
   those cases. Intent currentness permits preparation only; native monitoring readiness, programme isolation and
   audible A/B need their own evidence.
8. **Cold frozen export restoration must finish before rendering.** The clip-only restoration set from
   `57b7349f7864` survived owner-use-case routing in `ab5a579209b5` (#187). Input: a fresh runtime whose active
   frozen print is durable but absent from memory, beside an ordinary clip. Hold restoration: no render or encode;
   release it through the real cache owner: active frozen PCM appears in both mixdown and stems. Remove only its
   requested ID: failure before encoding. Preserve stale-print exclusion, the empty-clip fallback, cancellation and
   the dialog session fence (a late older callback must not paint a reopened dialog).
9. **VCA membership must reach committed runtime gain (`22a84b216658`, #1049).** The Inspector's direct calls
   bypassed the committed gain continuation. Drive Create, Assign and None through the mounted gesture, real
   Command, handler and reconciler. At the engine caller raw CRDT and projection agree and composed static or
   automated gain at the selected beat is observed through the gesture, Undo and Redo. Seed a non-unity group and an
   automated peer; check the scheduled value, no duplicate subject scheduling, unrelated tracks preserved. Reverting
   the matching component dispatch must fail its history and gain case. Queued gesture (caught in #5789 review):
   a gesture waiting for a root snapshot must not reach a same-ID successor root, while an ordinary snapshot on the
   same project still lets it through; hold and release the real queue around production root replacement and
   inspect successor state, history and engine calls.
10. **Live cancellation is not durable cancellation (#1949, `ce2ffea3fd`).** Pending-confirmation cancellation
    revoked its run before cleanup, but its already-terminal retry trusted live state after local persistence
    failed. Inject a real `Storage.setItem` failure during cancellation; the live run is terminal while the saved run
    is unchanged; cancel the same confirmation again. The retry must persist that exact run before releasing
    temporary run assets or confirmation resources, and must not report success while cleanup is pending. Repeat
    without temporary assets: an already-terminal no-op cannot prove persistence. A mocked cancellation helper misses
    the live-store-before-storage seam.
11. **A lifecycle control's label and action read different states (#5912; `b4da902197`).** The track menu labelled
    its freeze item `Update Freeze` from `freezeState.status === 'stale'` while its action branched on `track.frozen`;
    a stale track keeps `frozen: true`, so Update Freeze dispatched `unfreezeTrack` and discarded the take the user
    asked to refresh, and the Inspector did the same when `frozen || stale`. A refresh also keeps `frozen: true`
    while rendering, so a label chosen from `frozen` offered Unfreeze mid-render and the unstopped render re-froze
    the track. The menu spec asserted only the stale label; the Inspector spec asserted `unfreezeTrack`, encoding the
    defect. List every reachable pair of the coarse flag and the lifecycle status, including transient states an
    operation writes before it settles (`freezing` with either flag, `error` with either flag); for each pair assert
    the label and the dispatched action in every control that offers them (track menu and Inspector are separate
    routes), deriving each expected action from what the label promises, never from current behavior. Narrow each
    routing branch to a single status (for example `frozen && !stale` to `status === 'frozen'`): some per-state case
    must fail.
12. **A cancel restores the state the cancelled operation replaced (#5912).** Cancelling a refresh wrote status
    `unfrozen` and left `frozen` and the old buffer in place; Unfreeze then returned early on that status, so no
    control could leave the state. Cancel an operation that replaced a settled state at each await it crosses and
    assert the full prior state returns: flag, status and every field the status carries. Regression guards for the
    repair: cancel the first run from an initial state and assert the flag as well as the status (catches a restore
    that sets the flag unconditionally); cancel during the last await while the awaited call still resolves and prove
    through the registered action pipeline that the aborted transaction restores the prior state (a unit test with a
    mocked repository cannot show the rollback).
