//! The one host pump every format's editor run loop is serviced from.
//!
//! On X11 a plugin editor has no event loop of its own: a VST3 editor hands the
//! host its descriptors and timers through `IRunLoop`, and a CLAP plugin through
//! `clap.timer-support` and `clap.posix-fd-support`. Both formats require the
//! callbacks to arrive on the thread that owns the editor's window, which is the
//! shell's UI thread, and that thread calls [`service_editor_run_loops`] from its
//! own loop. This module is the format-neutral half of that: the process-wide
//! set of registered run loops, the registration that leaves it, and the pass.
//! What a run loop holds and how it dispatches is its format's own module
//! ([`crate::vst3_run_loop`], [`crate::clap_run_loop`]).
//!
//! Nothing here is reachable from the audio thread.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

/// One format's run loop, as the pump drives it.
pub trait ServicedRunLoop: Send + Sync {
    /// Fire what is due and dispatch what is ready, then return how many
    /// callbacks ran. Never waits: it runs on the thread that has to keep
    /// drawing.
    fn service_once(&self) -> usize;
}

/// One registered run loop and the lock a pass over it holds.
struct PumpedRunLoop {
    id: RunLoopId,
    run_loop: Arc<dyn ServicedRunLoop>,
    /// Whether the registration has dropped. Held for the whole of one pass,
    /// and set by the registration's drop.
    ///
    /// A pass calls into code the run loop's owner is about to release, so the
    /// owner may not release it while one is running, and a pass that copied
    /// the set before the drop must not start once the drop has returned.
    /// Uncontended whenever the shell's pump and the owner's teardown are the
    /// same thread, which is the arrangement both formats' lifecycles keep; the
    /// lock is what makes the other arrangement wait rather than free a
    /// handler mid-call.
    retired: Mutex<bool>,
}

/// Names one registration, so a drop removes its own and no other.
type RunLoopId = u64;

/// Every registered run loop, in registration order.
///
/// Process-wide because what pumps it is: one UI thread serves every editor
/// this host has open, and the alternative — carrying a run-loop host down
/// through `AudioPlugin::open_gui` — would put a platform's event loop into a
/// seam that is deliberately shell-independent.
static EDITOR_RUN_LOOPS: Mutex<Vec<Arc<PumpedRunLoop>>> = Mutex::new(Vec::new());

fn editor_run_loops() -> MutexGuard<'static, Vec<Arc<PumpedRunLoop>>> {
    EDITOR_RUN_LOOPS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// One run loop's place in the pumped set, given up on drop.
pub struct EditorRunLoopRegistration {
    pumped: Arc<PumpedRunLoop>,
}

/// Ask the host's UI loop to start servicing this run loop.
pub fn register_editor_run_loop<R: ServicedRunLoop + 'static>(
    run_loop: Arc<R>,
) -> EditorRunLoopRegistration {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    let pumped = Arc::new(PumpedRunLoop {
        id: NEXT.fetch_add(1, Ordering::Relaxed),
        run_loop,
        retired: Mutex::new(false),
    });
    editor_run_loops().push(Arc::clone(&pumped));
    EditorRunLoopRegistration { pumped }
}

impl Drop for EditorRunLoopRegistration {
    /// Leave the pumped set, wait out a pass already inside this loop, and
    /// turn away any pass that copied the set before it was left.
    fn drop(&mut self) {
        let id = self.pumped.id;
        editor_run_loops().retain(|pumped| pumped.id != id);
        *lock_pass(&self.pumped) = true;
    }
}

fn lock_pass(pumped: &PumpedRunLoop) -> MutexGuard<'_, bool> {
    pumped
        .retired
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Service one loop, unless its registration dropped before this pass reached
/// it.
fn service_pumped(pumped: &PumpedRunLoop) -> usize {
    let retired = lock_pass(pumped);
    if *retired {
        return 0;
    }
    pumped.run_loop.service_once()
}

/// One pass over every registered run loop. Returns how many callbacks ran.
///
/// The set is copied out before any of them runs: the callbacks are editor
/// code, and an editor that closes from inside its own callback would otherwise
/// deadlock against the set it is already inside.
pub fn service_editor_run_loops() -> usize {
    let open: Vec<Arc<PumpedRunLoop>> = editor_run_loops().iter().map(Arc::clone).collect();

    open.iter().map(|pumped| service_pumped(pumped)).sum()
}

/// Whether a run loop is still in the pumped set. For tests that prove a
/// teardown left it.
#[cfg(test)]
pub(crate) fn is_pumped(run_loop: &Arc<dyn ServicedRunLoop>) -> bool {
    editor_run_loops()
        .iter()
        .any(|pumped| Arc::ptr_eq(&pumped.run_loop, run_loop))
}

/// Ask the kernel which of `poll_fds` are ready right now, filling each
/// `revents`. Answers `false` when nothing is ready or the poll failed.
///
/// Zero timeout: a pass on the UI thread has no time to wait in.
pub(crate) fn poll_now(poll_fds: &mut [libc::pollfd]) -> bool {
    if poll_fds.is_empty() {
        return false;
    }
    // SAFETY: `poll_fds` is a live, correctly sized array of `pollfd`, and the
    // length is its own element count.
    let ready = unsafe { libc::poll(poll_fds.as_mut_ptr(), poll_fds.len() as libc::nfds_t, 0) };
    ready > 0
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    #[derive(Default)]
    struct CountingRunLoop {
        passes: AtomicUsize,
    }

    impl ServicedRunLoop for CountingRunLoop {
        fn service_once(&self) -> usize {
            self.passes.fetch_add(1, Ordering::AcqRel);
            1
        }
    }

    #[test]
    fn a_registered_run_loop_is_serviced_until_its_registration_drops() {
        let counting = Arc::new(CountingRunLoop::default());
        let run_loop: Arc<dyn ServicedRunLoop> = counting.clone();

        let registration = register_editor_run_loop(Arc::clone(&counting));
        service_editor_run_loops();
        assert_eq!(counting.passes.load(Ordering::Acquire), 1);
        assert!(is_pumped(&run_loop));

        drop(registration);
        service_editor_run_loops();
        assert_eq!(
            counting.passes.load(Ordering::Acquire),
            1,
            "a dropped registration is not serviced again"
        );
        assert!(!is_pumped(&run_loop));
    }

    /// A pass that copied the set before a drop on another thread reaches the
    /// loop only after the drop returned, when its owner may already have
    /// released what the loop calls into.
    #[test]
    fn a_pass_that_copied_the_set_before_a_drop_calls_nothing_after_it() {
        let counting = Arc::new(CountingRunLoop::default());
        let registration = register_editor_run_loop(Arc::clone(&counting));
        let copied_by_a_pass = Arc::clone(&registration.pumped);

        drop(registration);

        assert_eq!(service_pumped(&copied_by_a_pass), 0);
        assert_eq!(
            counting.passes.load(Ordering::Acquire),
            0,
            "a loop whose registration dropped is never called"
        );
    }

    /// The drop waits out a pass that is already inside the loop, because the
    /// owner releases what that pass is calling into the moment drop returns.
    #[test]
    fn dropping_a_registration_waits_out_a_pass_in_flight() {
        struct BlockingRunLoop {
            entered: std::sync::mpsc::SyncSender<()>,
            release: Mutex<std::sync::mpsc::Receiver<()>>,
            finished: AtomicUsize,
        }

        impl ServicedRunLoop for BlockingRunLoop {
            fn service_once(&self) -> usize {
                let _ = self.entered.send(());
                let _ = self.release.lock().unwrap().recv();
                self.finished.fetch_add(1, Ordering::AcqRel);
                1
            }
        }

        let (entered_tx, entered_rx) = std::sync::mpsc::sync_channel(1);
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let blocking = Arc::new(BlockingRunLoop {
            entered: entered_tx,
            release: Mutex::new(release_rx),
            finished: AtomicUsize::new(0),
        });
        let registration = register_editor_run_loop(blocking.clone());

        let pump = std::thread::spawn(service_editor_run_loops);
        entered_rx.recv().unwrap();

        let releaser = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(50));
            release_tx.send(()).unwrap();
        });
        drop(registration);

        assert_eq!(
            blocking.finished.load(Ordering::Acquire),
            1,
            "drop returned only after the pass in flight finished"
        );
        releaser.join().unwrap();
        pump.join().unwrap();
    }
}
