//! Running one call on the shell's UI thread and waiting for it.
//!
//! Both hosted plugin formats make their editor lifecycle thread-affine: CLAP
//! marks the `gui` extension `[main-thread]`, and VST3 specifies `IPlugView` to
//! be driven from the thread that owns the parent window. On macOS `attached`
//! mutates the AppKit view hierarchy, which off the main thread is a crash
//! rather than a mistake. The command bodies run on the async executor's
//! workers, so an editor call has to be carried to the shell's thread and its
//! answer carried back.
//!
//! Two rules keep that carry from deadlocking, and neither is optional.
//!
//! The first is that the claim stays behind. An editor command takes the
//! runtime owner's control gate on its own worker and only then hands the
//! plugin call over; the UI thread never waits for a control gate itself. The
//! other arrangement closes a cycle — the UI thread waiting on a gate whose
//! holder is waiting for the UI thread — and the app freezes with no way out.
//!
//! The second is that a call already on the UI thread runs there, inline. The
//! editor lifecycle re-enters the host from inside its own calls (a VST3 view
//! resizes the host window from inside `attached`), and posting that re-entry
//! to the thread it is already on would wait for a turn that cannot come until
//! it returns.
//!
//! Those two keep the ordinary path acyclic. What keeps the reverse one
//! survivable is that this wait is the bounded side of the pair: the shell's
//! own quit cascade runs on the UI thread and does claim control gates there,
//! so a worker holding a gate while waiting here is a cycle the ordering rules
//! alone cannot rule out. An implementation therefore gives up after a
//! deadline, which releases the claim and lets the UI thread through. The
//! control gate is an unbounded wait and cannot be the one to yield.

use std::sync::mpsc;
use std::sync::{Arc, Mutex, MutexGuard};

/// One closure waiting for its turn on the UI thread.
///
/// The closure sits behind a mutex its runner holds for the whole call, which
/// is what makes a deadline safe to have: a caller that gives up either
/// withdraws work that never started, or blocks in [`Self::withdraw`] until
/// work that did start has finished. It never comes back while the UI thread is
/// still inside a borrow the closure was lent.
pub struct UiThreadTask {
    work: Mutex<Option<Box<dyn FnOnce() + Send>>>,
}

impl UiThreadTask {
    pub fn new(work: impl FnOnce() + Send + 'static) -> Arc<Self> {
        Arc::new(Self {
            work: Mutex::new(Some(Box::new(work))),
        })
    }

    /// Run the work, unless it was already withdrawn. Called on the UI thread.
    pub fn run(&self) {
        let mut slot = self.lock();
        if let Some(work) = slot.take() {
            work();
        }
    }

    /// Take the work back, and report whether there was any left to take.
    ///
    /// `false` means the UI thread got there first, and this call waited for it
    /// to finish rather than returning while it ran.
    pub fn withdraw(&self) -> bool {
        self.lock().take().is_some()
    }

    /// A panic inside the work poisons the slot; the slot is still empty and
    /// still says what it always said, so taking it back is the honest read.
    fn lock(&self) -> MutexGuard<'_, Option<Box<dyn FnOnce() + Send>>> {
        self.work
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// The shell's UI thread, as far as plugin editors are concerned.
///
/// Implemented by the same seam that owns the editor windows, because it is the
/// same shell and the same thread: a window may only be touched from the thread
/// that made it.
pub trait UiThread: Send + Sync {
    /// Whether the calling thread is the UI thread.
    ///
    /// A host with no thread of its own answers `true`: the caller's thread is
    /// the only one there is, so it is the one that will do the work.
    fn is_ui_thread(&self) -> bool {
        true
    }

    /// Hand `task` to the UI thread and wait until it has run, or report why it
    /// could not be.
    ///
    /// Returning `Ok` means the task ran; returning `Err` means it did not and
    /// never will. Neither answer may be given while the task is still running.
    ///
    /// An implementation with a real thread bounds this wait — see the module
    /// note on why the deadline is what breaks the reverse cycle — and
    /// [`UiThreadTask::withdraw`] is how it gives up without racing a task that
    /// started in the same instant.
    fn run_on_ui_thread(&self, task: &Arc<UiThreadTask>) -> Result<(), String> {
        task.run();
        Ok(())
    }
}

/// Run `work` on the UI thread and return what it produced.
///
/// Inline when the caller already is the UI thread — see the module note for
/// why that is a correctness rule and not an optimisation.
pub fn call_on_ui_thread<Ui: UiThread + ?Sized, Produced: Send + 'static>(
    ui: &Ui,
    work: impl FnOnce() -> Produced + Send + 'static,
) -> Result<Produced, String> {
    if ui.is_ui_thread() {
        return Ok(work());
    }

    let (answer, answered) = mpsc::sync_channel(1);
    let task = UiThreadTask::new(move || {
        let _ = answer.send(work());
    });
    ui.run_on_ui_thread(&task)?;

    answered
        .try_recv()
        .map_err(|_| "The shell's UI thread ran the editor call without answering".to_string())
}

/// A `&mut` lent to the UI thread for exactly one call.
///
/// The borrow itself cannot cross: it is neither `Send` nor `'static`, and a
/// plugin runtime is `Send` only through the access seam that hands this
/// borrow out. What makes the lend sound is that [`call_on_ui_thread`] does not
/// return until the closure has run or been withdrawn unrun, so the lender is
/// parked for every instant the borrow is readable anywhere else.
pub struct LentMut<Value: ?Sized>(*mut Value);

// SAFETY: the pointer is only ever dereferenced inside one `call_on_ui_thread`,
// whose caller holds the `&mut` it came from and is blocked for that call's
// whole duration. No second reference to the value exists while it is used.
unsafe impl<Value: ?Sized> Send for LentMut<Value> {}

impl<Value: ?Sized> LentMut<Value> {
    pub fn new(value: &mut Value) -> Self {
        Self(value)
    }

    /// Take the lent borrow back up on the other thread.
    ///
    /// By value, so one lend is one use.
    ///
    /// # Safety
    /// Call only from inside the [`call_on_ui_thread`] this lend was made for,
    /// which is the only window in which the lender is parked.
    pub unsafe fn with<Produced>(self, use_it: impl FnOnce(&mut Value) -> Produced) -> Produced {
        // SAFETY: the caller's contract above.
        use_it(unsafe { &mut *self.0 })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::thread::{self, ThreadId};

    /// A UI thread that runs every task on one dedicated thread of its own,
    /// which is how a shell's main loop behaves.
    struct DedicatedUiThread {
        work: mpsc::Sender<Arc<UiThreadTask>>,
        thread_id: ThreadId,
        thread: Option<thread::JoinHandle<()>>,
    }

    impl DedicatedUiThread {
        fn start() -> Self {
            let (work, queued) = mpsc::channel::<Arc<UiThreadTask>>();
            let (announce, announced) = mpsc::channel();
            let thread = thread::spawn(move || {
                announce
                    .send(thread::current().id())
                    .expect("the UI thread must announce itself");
                while let Ok(task) = queued.recv() {
                    task.run();
                }
            });
            let thread_id = announced.recv().expect("the UI thread must start");
            Self {
                work,
                thread_id,
                thread: Some(thread),
            }
        }
    }

    impl Drop for DedicatedUiThread {
        fn drop(&mut self) {
            let (closed, _) = mpsc::channel();
            drop(std::mem::replace(&mut self.work, closed));
            if let Some(thread) = self.thread.take() {
                let _ = thread.join();
            }
        }
    }

    impl UiThread for DedicatedUiThread {
        fn is_ui_thread(&self) -> bool {
            thread::current().id() == self.thread_id
        }

        fn run_on_ui_thread(&self, task: &Arc<UiThreadTask>) -> Result<(), String> {
            // A real shell's loop cannot answer this either — it would be
            // waiting for the turn the caller is holding — but it would hang
            // rather than say so, and a hang proves nothing about what broke.
            if self.is_ui_thread() {
                return Err("a task posted from the UI thread waits for its own turn".to_string());
            }
            let (done, waited) = mpsc::sync_channel(1);
            let queued = Arc::clone(task);
            self.work
                .send(UiThreadTask::new(move || {
                    queued.run();
                    let _ = done.send(());
                }))
                .map_err(|_| "the UI thread is gone".to_string())?;
            waited
                .recv()
                .map_err(|_| "the UI thread never answered".to_string())
        }
    }

    /// The whole point of the seam: a call made on a worker runs somewhere else.
    #[test]
    fn a_call_made_off_the_ui_thread_runs_on_it() {
        let ui = DedicatedUiThread::start();

        let ran_on = call_on_ui_thread(&ui, || thread::current().id()).expect("the task runs");

        assert_eq!(ran_on, ui.thread_id);
        assert_ne!(
            ran_on,
            thread::current().id(),
            "the fake UI thread must not be this one, or this test proves nothing"
        );
    }

    /// The re-entrancy rule. A VST3 view resizes its host window from inside
    /// `attached`, which is already running on the UI thread — posting that
    /// resize would wait for a turn the attach itself is holding up.
    #[test]
    fn a_call_already_on_the_ui_thread_runs_there_rather_than_waiting_for_a_turn() {
        let ui = Arc::new(DedicatedUiThread::start());
        let reached_again = Arc::clone(&ui);

        let nested = call_on_ui_thread(ui.as_ref(), move || {
            call_on_ui_thread(reached_again.as_ref(), || thread::current().id())
        })
        .expect("the outer task runs")
        .expect("a nested call must not wait for the turn the outer one is holding");

        assert_eq!(
            nested, ui.thread_id,
            "a nested call must run on the thread it was already on"
        );
    }

    /// A host that reports the caller's thread as the UI thread, which is what
    /// every implementation does once it is already on it.
    struct InlineWhenAsked;

    impl UiThread for InlineWhenAsked {}

    /// A host with no separate thread runs the work where it stands, so an
    /// editor path that never reaches a shell still behaves.
    #[test]
    fn a_host_with_no_ui_thread_of_its_own_runs_the_work_in_place() {
        let ran_on = call_on_ui_thread(&InlineWhenAsked, || thread::current().id())
            .expect("the task runs in place");

        assert_eq!(ran_on, thread::current().id());
    }

    /// The deadline's half of the contract: work the UI thread never got to is
    /// taken back, and taking it back is what guarantees it will not run later
    /// against a borrow the caller has already given up.
    #[test]
    fn work_the_ui_thread_never_reached_is_withdrawn_unrun() {
        let ran = Arc::new(AtomicBool::new(false));
        let marker = Arc::clone(&ran);
        let task = UiThreadTask::new(move || marker.store(true, Ordering::Release));

        assert!(task.withdraw(), "unrun work must be there to withdraw");
        task.run();

        assert!(
            !ran.load(Ordering::Acquire),
            "withdrawn work must never run afterwards"
        );
    }

    /// The other half: work that already ran cannot be withdrawn, so a caller
    /// that reaches its deadline in the same instant learns it happened.
    #[test]
    fn work_the_ui_thread_already_ran_cannot_be_withdrawn() {
        let task = UiThreadTask::new(|| {});

        task.run();

        assert!(!task.withdraw());
    }
}
