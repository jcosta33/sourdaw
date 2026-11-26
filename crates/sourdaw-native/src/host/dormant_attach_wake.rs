//! The wake owed to a dormant instance the engine attach could not take yet.
//!
//! The attach (`commands::plugins::attach_dormant_plugins`) runs inside a graph
//! batch, which holds the graph registry guard and so cannot wait for anything.
//! Three holds refuse it for a moment only: the instance's lifecycle lease (a
//! load, an unload or an editor close), a dormant control call still holding a
//! clone of the runtime owner, and the plugin-runtime gate held by the
//! unload-all writer. Left to the next graph batch, an instance refused by any
//! of them stays silent until the musician happens to edit something, so the
//! refusal records a re-attach owed against the hold that refused it, and the
//! hold's release wakes the re-attach worker (`commands::dormant_reattach`).
//!
//! The lease and the gate are counted holds. Each keeps a release count; a pass
//! snapshots the counts before it tries anything, and when it is refused it
//! owes a wake for that kind. A release of that kind counted since the snapshot
//! makes the wake due at once, because that release came too late for the pass
//! to see and too early to find anything owed.
//!
//! A dormant call is owed per runtime, because the clones that refuse it are
//! everywhere — every editor drain snapshots every dormant runtime — and a
//! release of any of them is no news about the one that was refused. The debt
//! names the refused runtime, and only that runtime losing its last outside
//! clone pays it. The debt reads the runtime's strong count under the wake lock
//! and the release reads it before taking that lock, so a clone let go between
//! the refusal and the debt is seen by the debt itself.
//!
//! A release only wakes what it is owed: an editor snapshot dropping clones
//! never re-runs a pass that another instance's call or a held lease refused,
//! so no release that a pass itself causes can keep a refused instance spinning.
//!
//! Nothing here runs on the audio thread: every release is a control-side drop.

use crate::host::native_bridge::SharedHostedPlugin;
use std::ops::Deref;
use std::sync::{Arc, Condvar, Mutex, MutexGuard, Weak};

/// A counted hold that refused a whole instance's attach.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AttachHold {
    /// A load, an unload or an editor close held the instance's lifecycle lease.
    LifecycleLease,
    /// The unload-all writer held the plugin-runtime gate.
    RuntimeGate,
}

const HOLD_KINDS: usize = 2;

impl AttachHold {
    fn slot(self) -> usize {
        match self {
            Self::LifecycleLease => 0,
            Self::RuntimeGate => 1,
        }
    }
}

/// The release counts a pass read before it tried anything.
#[derive(Debug, Clone, Copy)]
pub(crate) struct ReleaseCounts([u64; HOLD_KINDS]);

struct WakeState {
    releases: [u64; HOLD_KINDS],
    owed: [bool; HOLD_KINDS],
    /// The dormant runtimes a pass found a call still inside.
    owed_runtimes: Vec<Weak<SharedHostedPlugin>>,
    due: bool,
}

static WAKE: Mutex<WakeState> = Mutex::new(WakeState {
    releases: [0; HOLD_KINDS],
    owed: [false; HOLD_KINDS],
    owed_runtimes: Vec::new(),
    due: false,
});
static WAKE_DUE: Condvar = Condvar::new();

/// Poisoning is ignored: every field is written whole under the lock, so a
/// panic elsewhere cannot leave the state half-updated.
fn wake_state() -> MutexGuard<'static, WakeState> {
    WAKE.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn mark_due(state: &mut WakeState) {
    state.due = true;
    WAKE_DUE.notify_all();
}

/// Read the release counts, before the attach tries its first hold.
pub(crate) fn release_counts() -> ReleaseCounts {
    ReleaseCounts(wake_state().releases)
}

/// Count one release of `hold`, and wake the re-attach if a refusal is owed it.
///
/// Called once the hold is really gone — the lease's guard dropped, the gate's
/// writer dropped — so a woken pass never finds the hold it was woken for still
/// in place.
pub(crate) fn note_hold_released(hold: AttachHold) {
    let mut state = wake_state();
    let slot = hold.slot();
    state.releases[slot] = state.releases[slot].wrapping_add(1);
    if state.owed[slot] {
        state.owed[slot] = false;
        mark_due(&mut state);
    }
}

/// Owe a re-attach for every hold that refused the pass that read `since`.
pub(crate) fn owe_reattach(holds: impl IntoIterator<Item = AttachHold>, since: ReleaseCounts) {
    let mut state = wake_state();
    for hold in holds {
        let slot = hold.slot();
        if state.releases[slot] == since.0[slot] {
            state.owed[slot] = true;
        } else {
            mark_due(&mut state);
        }
    }
}

/// Owe a re-attach to the dormant runtime a call was still inside, once it is
/// back in its map.
///
/// The map's own reference is the one left when the call lets go, so a count
/// already down to it is a call that let go before this ran: the wake is due
/// now. A runtime already gone was unloaded, and nothing is owed to it.
pub(crate) fn owe_reattach_when_free(refused: &Weak<SharedHostedPlugin>) {
    let mut state = wake_state();
    state.owed_runtimes.retain(|owed| owed.strong_count() > 0);
    match refused.strong_count() {
        0 => {}
        1 => mark_due(&mut state),
        _ => {
            if !state
                .owed_runtimes
                .iter()
                .any(|owed| Weak::ptr_eq(owed, refused))
            {
                state.owed_runtimes.push(Weak::clone(refused));
            }
        }
    }
}

/// Pay the debt owed to `runtime`, if one is, now that only its map holds it.
fn note_dormant_runtime_free(state: &mut WakeState, runtime: &Weak<SharedHostedPlugin>) {
    let Some(position) = state
        .owed_runtimes
        .iter()
        .position(|owed| Weak::ptr_eq(owed, runtime))
    else {
        return;
    };
    state.owed_runtimes.swap_remove(position);
    mark_due(state);
}

/// Block until a hold a refusal was owed has been released, and take the wake.
pub(crate) fn wait_for_owed_reattach() {
    let mut state = wake_state();
    while !state.due {
        state = WAKE_DUE
            .wait(state)
            .unwrap_or_else(|poisoned| poisoned.into_inner());
    }
    state.due = false;
}

/// Make a wake due with nothing released, so a test can stop the worker it
/// started without waiting for a hold of its own.
#[cfg(test)]
pub(crate) fn raise_reattach_wake() {
    mark_due(&mut wake_state());
}

/// Take a due wake without blocking, so a test that runs no worker can read
/// whether a release made one due.
#[cfg(test)]
pub(crate) fn take_due_reattach_wake() -> bool {
    std::mem::take(&mut wake_state().due)
}

/// The release the plugin-runtime gate's writer owes the attach, noted when
/// this is dropped. The writer declares it ahead of its guard, so it drops
/// after the guard on every path out, an early return included.
pub(crate) struct RuntimeGateRelease;

impl Drop for RuntimeGateRelease {
    fn drop(&mut self) {
        note_hold_released(AttachHold::RuntimeGate);
    }
}

/// The release a dormant runtime owner's clones owe the attach.
///
/// Held beside the clones it watches and dropped after them: once they are
/// gone, a runtime left with only the map's own reference is one the attach can
/// now take, and that pays the debt a call refusal recorded for that runtime
/// alone. A clone dropped while another holder still has its own wakes nothing
/// — that holder's drop will.
pub(crate) struct DormantRuntimeRelease(Vec<Weak<SharedHostedPlugin>>);

impl DormantRuntimeRelease {
    pub(crate) fn watching<'runtime>(
        runtimes: impl IntoIterator<Item = &'runtime Arc<SharedHostedPlugin>>,
    ) -> Self {
        Self(runtimes.into_iter().map(Arc::downgrade).collect())
    }
}

impl Drop for DormantRuntimeRelease {
    fn drop(&mut self) {
        let mut state = None;
        for runtime in self.0.iter().filter(|runtime| runtime.strong_count() == 1) {
            note_dormant_runtime_free(state.get_or_insert_with(wake_state), runtime);
        }
    }
}

/// One instance's runtime owner, cloned out of its map for a call.
///
/// A clone taken from the command-owned map carries the release above, so the
/// attach it refused hears when it lets go; an engine-owned one carries none,
/// because no attach waits on it. Field order is drop order, and it is load
/// bearing: the clone goes first, so the release reads the count it left.
pub(crate) struct RuntimeClone {
    runtime: Arc<SharedHostedPlugin>,
    _release: Option<DormantRuntimeRelease>,
}

impl RuntimeClone {
    pub(crate) fn dormant(runtime: &Arc<SharedHostedPlugin>) -> Self {
        Self {
            runtime: Arc::clone(runtime),
            _release: Some(DormantRuntimeRelease::watching([runtime])),
        }
    }

    pub(crate) fn engine_owned(runtime: &Arc<SharedHostedPlugin>) -> Self {
        Self {
            runtime: Arc::clone(runtime),
            _release: None,
        }
    }
}

impl Deref for RuntimeClone {
    type Target = Arc<SharedHostedPlugin>;

    fn deref(&self) -> &Self::Target {
        &self.runtime
    }
}
