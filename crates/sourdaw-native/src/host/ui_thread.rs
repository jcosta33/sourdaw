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
//! The same carry serves a runtime's construction and its teardown, which both
//! formats bind to the host's main thread as well: VST3 module entry, factory
//! use and component `initialize`, CLAP `plugin.init` and `destroy`. Off it a
//! plugin whose module startup builds a Qt application trips a macOS
//! main-queue assertion and takes the whole app down.
//!
//! Two rules keep that carry from deadlocking, and neither is optional.
//!
//! The first is that the gate stays behind. An editor command takes the
//! runtime owner's control gate on its own worker and only then hands the
//! plugin call over; the UI thread never waits for a control gate itself. The
//! other arrangement closes a cycle — the UI thread waiting on a gate whose
//! holder is waiting for the UI thread — and the app freezes with no way out.
//!
//! The audio access seam is the other way round: it does not cross the wait at
//! all. The worker hops holding only the gate, and the call claims the seam
//! when it lands on the UI thread, for as long as the plugin call itself
//! (`ControlVisit::on_ui_thread` in `native_bridge.rs`). The seam is the one
//! claim the audio thread competes for, and a hop can wait for as long as the
//! shell's thread is busy; held across that wait, it skips the plugin's blocks
//! for the whole of it. Landed, the call makes a single non-blocking try at the
//! seam and the UI thread never waits for it: a plugin whose block hangs holds
//! the seam indefinitely, and the UI thread is the shell's one thread for every
//! window. A busy seam returns the call unrun to the worker, which still holds
//! the gate, backs off off the UI thread, and hops again until its own timeout.
//! A visit already on the UI thread (a window close, the quit cascade) has no
//! other thread to back off on, so it retries for a few milliseconds only
//! (`UI_THREAD_SEAM_WAIT`) before refusing.
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
//! control gate's own deadline is sized for a hung plugin, far beyond the
//! shell's force-exit deadline, so it cannot be the one to yield.

use std::fmt;
use std::sync::mpsc;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

/// How long a worker waits for the shell's UI thread to take an editor call
/// before it withdraws it.
///
/// A worker waits here holding a plugin's control gate, and the main thread may
/// be blocked on that very gate — the one cycle the ordering rules above cannot
/// rule out. What ends it is this side giving up, so the bound is chosen against
/// what is waiting behind it: two seconds is the control timeout every editor
/// command already spends, so a hop can never outlast the claim it runs inside,
/// and the shell's own assertion keeps it clear of the deadline at which the
/// shell stops waiting for a graceful exit and kills every plugin mid-flight.
pub const EDITOR_UI_THREAD_DEADLINE: Duration = Duration::from_secs(2);

/// Why a call carried to the UI thread did not run there, or ran without
/// answering.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UiThreadError {
    /// The UI thread did not take the call before the caller's deadline, and
    /// the call was withdrawn unrun.
    NotRunInTime,
    /// The UI thread ran the call but its answer never came back.
    Unanswered,
    /// The shell's own reason, text this crate does not generate.
    Shell(String),
}

impl fmt::Display for UiThreadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotRunInTime => {
                f.write_str("The shell's UI thread did not run the editor call in time")
            }
            Self::Unanswered => {
                f.write_str("The shell's UI thread ran the editor call without answering")
            }
            Self::Shell(reason) => f.write_str(reason),
        }
    }
}

impl std::error::Error for UiThreadError {}

/// A shell implementation's reason for not reaching its UI thread.
impl From<String> for UiThreadError {
    fn from(reason: String) -> Self {
        Self::Shell(reason)
    }
}

/// One closure waiting for its turn on the UI thread.
///
/// The closure sits behind a mutex its runner holds for the whole call, which
/// is what makes a deadline safe to have: a caller that gives up either
/// withdraws work that never started, or blocks in [`Self::withdraw`] until
/// work that did start has finished. It never comes back while the UI thread is
/// still inside a borrow the closure was lent.
pub struct UiThreadTask {
    work: Mutex<Option<Box<dyn FnOnce() + Send>>>,
    release: bool,
}

impl UiThreadTask {
    pub fn new(work: impl FnOnce() + Send + 'static) -> Arc<Self> {
        Arc::new(Self {
            work: Mutex::new(Some(Box::new(work))),
            release: false,
        })
    }

    /// A task whose whole work is dropping a runtime on the UI thread.
    ///
    /// The mark is what lets a holder of the UI thread run releases and nothing
    /// else — see [`UiThread::run_posted_releases`]. Any other task may call into
    /// third-party code under a worker's control claim, with no bound the
    /// holder could charge it to.
    pub fn new_release(work: impl FnOnce() + Send + 'static) -> Arc<Self> {
        Arc::new(Self {
            work: Mutex::new(Some(Box::new(work))),
            release: true,
        })
    }

    pub fn is_release(&self) -> bool {
        self.release
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
    fn run_on_ui_thread(&self, task: &Arc<UiThreadTask>) -> Result<(), UiThreadError> {
        task.run();
        Ok(())
    }

    /// [`Self::run_on_ui_thread`], giving up once `deadline` has passed with the
    /// task not yet started, if that comes before the implementation's own.
    ///
    /// For a caller that serves every instance on a timer and must not stand
    /// behind one shell turn for longer than its tick allows: a withdrawn task
    /// never ran, so the caller retries it. A task the UI thread has started is
    /// still waited out, as [`Self::run_on_ui_thread`] does. The default is the
    /// unbounded wait, for an implementation that runs the task in place.
    fn run_on_ui_thread_within(
        &self,
        task: &Arc<UiThreadTask>,
        _deadline: Duration,
    ) -> Result<(), UiThreadError> {
        self.run_on_ui_thread(task)
    }

    /// Run, now, the runtime releases other threads have already posted to this
    /// UI thread and that its loop has not yet reached. Call it only on the UI
    /// thread. Every other posted task stays queued for the loop.
    ///
    /// For code that holds the UI thread for a long stretch and waits there for
    /// a worker whose own progress is a release hop onto it: the quit cascade
    /// runs synchronously on the UI thread, so the loop that would drain a
    /// worker's posted teardown cannot turn until the cascade returns. Releases
    /// only, because any other posted task is an editor call a worker made
    /// under its control claim, which the cascade has already closed the editors
    /// ahead of and cannot bound once running; its own deadline withdraws it.
    /// A host whose work runs inline, or which has no queue, has nothing posted
    /// and keeps this default.
    fn run_posted_releases(&self) {}
}

/// A UI thread reached by posting work to a queue that an external pump drains.
///
/// The whole protocol a shell loop needs, with nothing shell-specific left in
/// it: post the work, wake the pump, wait for the deadline, and take the work
/// back if the wait expires. Waking is the caller's, because only it knows how
/// to reach its own loop.
///
/// Every answer this gives obeys [`UiThread::run_on_ui_thread`]'s contract that
/// neither answer may be given while the task is still running. The single place
/// that could break it is giving up, and [`UiThreadTask::withdraw`] is what does
/// not: it blocks while the pump is inside the work, so a task that started an
/// instant before the deadline is reported as having run — which it did.
pub struct PostedUiThread {
    queued: Mutex<Vec<Arc<UiThreadTask>>>,
    deadline: Duration,
}

impl PostedUiThread {
    /// `deadline` is how long a caller waits before it takes its work back. See
    /// the module note on why this wait, and not the control gate's, is the one
    /// that yields.
    pub fn new(deadline: Duration) -> Self {
        Self {
            queued: Mutex::new(Vec::new()),
            deadline,
        }
    }

    /// Run everything posted so far. Called on the UI thread, by the pump.
    ///
    /// The queue is emptied before any work runs, so work posted from inside
    /// this pass waits for the next one rather than extending this one.
    pub fn drain(&self) {
        let queued = std::mem::take(&mut *self.lock());
        for task in queued {
            task.run();
        }
    }

    /// Run the posted releases and leave every other task queued, in its
    /// original order, for the pump. Called on the UI thread by a holder of it
    /// that cannot wait for the pump; see [`UiThread::run_posted_releases`].
    pub fn drain_releases(&self) {
        let releases: Vec<Arc<UiThreadTask>> = {
            let mut queued = self.lock();
            let (releases, others) = std::mem::take(&mut *queued)
                .into_iter()
                .partition(|task| task.is_release());
            *queued = others;
            releases
        };
        for task in releases {
            task.run();
        }
    }

    /// Post `task`, wake the pump with `wake`, and wait until the task has run.
    pub fn post_and_wait(
        &self,
        task: &Arc<UiThreadTask>,
        wake: impl FnOnce() -> Result<(), UiThreadError>,
    ) -> Result<(), UiThreadError> {
        self.post_and_wait_within(task, self.deadline, wake)
    }

    /// [`Self::post_and_wait`], giving up at `deadline` when that comes before
    /// this queue's own. See [`UiThread::run_on_ui_thread_within`].
    pub fn post_and_wait_within(
        &self,
        task: &Arc<UiThreadTask>,
        deadline: Duration,
        wake: impl FnOnce() -> Result<(), UiThreadError>,
    ) -> Result<(), UiThreadError> {
        let deadline = deadline.min(self.deadline);
        let (ran, waited) = mpsc::sync_channel(1);
        let inner = Arc::clone(task);
        let work = move || {
            inner.run();
            let _ = ran.send(());
        };
        // The wrapper is what the queue holds, so it carries the task's mark.
        let posted = if task.is_release() {
            UiThreadTask::new_release(work)
        } else {
            UiThreadTask::new(work)
        };
        self.lock().push(Arc::clone(&posted));

        if let Err(unreachable) = wake() {
            return self.give_up(&posted, unreachable);
        }

        if waited.recv_timeout(deadline).is_ok() {
            return Ok(());
        }

        self.give_up(&posted, UiThreadError::NotRunInTime)
    }

    /// Take the work back, and report `reason` only if there was work to take.
    ///
    /// A pump that ran the task and only then reported a failure — or that
    /// reached it a moment after the deadline — did the work, and the caller's
    /// answer is the truth about the work rather than about the wait.
    fn give_up(
        &self,
        posted: &Arc<UiThreadTask>,
        reason: UiThreadError,
    ) -> Result<(), UiThreadError> {
        self.lock().retain(|pending| !Arc::ptr_eq(pending, posted));
        if posted.withdraw() {
            return Err(reason);
        }
        Ok(())
    }

    /// A panic inside one task's work poisons the queue; the queue itself is
    /// just a list and the tasks in it are still runnable, so a later pass takes
    /// it rather than refusing every editor call for the life of the process.
    fn lock(&self) -> MutexGuard<'_, Vec<Arc<UiThreadTask>>> {
        self.queued
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Run `work` on the UI thread and return what it produced.
///
/// Inline when the caller already is the UI thread — see the module note for
/// why that is a correctness rule and not an optimisation.
pub fn call_on_ui_thread<Ui: UiThread + ?Sized, Produced: Send + 'static>(
    ui: &Ui,
    work: impl FnOnce() -> Produced + Send + 'static,
) -> Result<Produced, UiThreadError> {
    call_marked_on_ui_thread(ui, UiThreadTask::new, None, work)
}

/// [`call_on_ui_thread`], withdrawing the work if the UI thread has not started
/// it by `deadline`. See [`UiThread::run_on_ui_thread_within`].
pub fn call_on_ui_thread_within<Ui: UiThread + ?Sized, Produced: Send + 'static>(
    ui: &Ui,
    deadline: Duration,
    work: impl FnOnce() -> Produced + Send + 'static,
) -> Result<Produced, UiThreadError> {
    call_marked_on_ui_thread(ui, UiThreadTask::new, Some(deadline), work)
}

fn call_marked_on_ui_thread<Ui: UiThread + ?Sized, Produced: Send + 'static>(
    ui: &Ui,
    make_task: fn(Box<dyn FnOnce() + Send>) -> Arc<UiThreadTask>,
    deadline: Option<Duration>,
    work: impl FnOnce() -> Produced + Send + 'static,
) -> Result<Produced, UiThreadError> {
    if ui.is_ui_thread() {
        return Ok(work());
    }

    let (answer, answered) = mpsc::sync_channel(1);
    let task = make_task(Box::new(move || {
        let _ = answer.send(work());
    }));
    match deadline {
        Some(deadline) => ui.run_on_ui_thread_within(&task, deadline)?,
        None => ui.run_on_ui_thread(&task)?,
    }

    answered.try_recv().map_err(|_| UiThreadError::Unanswered)
}

/// Drop `value` on the UI thread, or hand it back with the reason it could not
/// be.
///
/// Dropping a hosted runtime is a plugin's teardown — CLAP `deactivate` and
/// `destroy`, VST3 `setActive(false)`, `terminate` and the module's exit — and
/// both formats bind those to the main thread. [`call_on_ui_thread`] cannot
/// carry it: a call it gives up on is withdrawn by dropping its closure on the
/// caller's thread, which would run the very teardown this exists to move. Here
/// the value waits in a slot the closure only empties, so a hop that never ran
/// leaves the value where the caller can take it back and try again later.
pub fn release_on_ui_thread<Ui, Value>(ui: &Ui, value: Value) -> Result<(), (Value, UiThreadError)>
where
    Ui: UiThread + ?Sized,
    Value: Send + 'static,
{
    let slot = Arc::new(Mutex::new(Some(value)));
    let released = Arc::clone(&slot);
    let outcome = call_marked_on_ui_thread(ui, release_task, None, move || {
        let value = take_slot(&released);
        drop(value);
    });
    match (outcome, take_slot(&slot)) {
        (Err(reason), Some(value)) => Err((value, reason)),
        // The closure emptied the slot, so the drop ran on the UI thread
        // whatever the hop reported about its own wait.
        _ => Ok(()),
    }
}

fn release_task(work: Box<dyn FnOnce() + Send>) -> Arc<UiThreadTask> {
    UiThreadTask::new_release(work)
}

/// Empty the slot, ignoring poison: a panic inside the value's own drop has
/// already taken it out, and what is left still says what it always said.
fn take_slot<Value>(slot: &Mutex<Option<Value>>) -> Option<Value> {
    slot.lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .take()
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

/// A shared borrow lent to the UI thread for exactly one call.
///
/// [`LentMut`]'s shared twin, for a target that is `Sync` and so may be read
/// from another thread, but whose borrow is not `'static`. Sound for the same
/// reason: [`call_on_ui_thread`] does not return until the closure has run or
/// been withdrawn unrun, so the lender — and the value it borrowed — outlives
/// every use made here.
pub struct LentRef<Value: ?Sized + Sync>(*const Value);

// SAFETY: `Value: Sync`, so a `&Value` may be used from any thread; the pointer
// is only dereferenced inside one `call_on_ui_thread` whose caller holds the
// borrow it came from and is blocked for that call's whole duration.
unsafe impl<Value: ?Sized + Sync> Send for LentRef<Value> {}

impl<Value: ?Sized + Sync> LentRef<Value> {
    pub fn new(value: &Value) -> Self {
        Self(value)
    }

    /// Take the lent borrow back up on the other thread.
    ///
    /// # Safety
    /// Call only from inside the [`call_on_ui_thread`] this lend was made for,
    /// which is the only window in which the lender is parked.
    pub unsafe fn with<Produced>(self, use_it: impl FnOnce(&Value) -> Produced) -> Produced {
        // SAFETY: the caller's contract above.
        use_it(unsafe { &*self.0 })
    }
}

/// Make one call against `target` on the UI thread, and wait for it.
///
/// The caller keeps whatever claim produced the `&mut` on its own thread for the
/// whole wait; only the call crosses. The borrow crosses with it as a
/// [`LentMut`] rather than as a reference, because a plugin runtime is reachable
/// across threads only through the access seam that produced this `&mut` — and
/// what makes the lend sound is that this does not return until the call has run
/// or been withdrawn unrun.
///
/// Not for a call into a registered runtime's editor: the `&mut` comes from the
/// audio access seam, which this would hold across the wait. Those go through
/// `ControlVisit::on_ui_thread` (`native_bridge.rs`), which claims the seam only
/// once the call has landed, with one try and no wait.
pub fn lend_on_ui_thread<Ui, Target, Produced>(
    ui: &Ui,
    target: &mut Target,
    call: impl FnOnce(&mut Target) -> Produced + Send + 'static,
) -> Result<Produced, UiThreadError>
where
    Ui: UiThread + ?Sized,
    Target: ?Sized + 'static,
    Produced: Send + 'static,
{
    let lent = LentMut::new(target);
    call_on_ui_thread(ui, move || {
        // SAFETY: the borrow is lent for exactly this call, and `call_on_ui_thread`
        // parks the lender for every instant it is readable here.
        unsafe { lent.with(call) }
    })
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

        fn run_on_ui_thread(&self, task: &Arc<UiThreadTask>) -> Result<(), UiThreadError> {
            // A real shell's loop cannot answer this either — it would be
            // waiting for the turn the caller is holding — but it would hang
            // rather than say so, and a hang proves nothing about what broke.
            if self.is_ui_thread() {
                return Err(UiThreadError::Shell(
                    "a task posted from the UI thread waits for its own turn".to_string(),
                ));
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
                .map_err(|_| UiThreadError::Shell("the UI thread never answered".to_string()))
        }
    }

    /// The releases-only drain runs what is a release and leaves every other
    /// task queued, in the order it was posted, for the pump.
    #[test]
    fn draining_releases_leaves_other_tasks_queued_in_order() {
        let posted = Arc::new(PostedUiThread::new(Duration::from_secs(10)));
        let log = Arc::new(Mutex::new(Vec::<&'static str>::new()));

        thread::scope(|scope| {
            // Posted one at a time, so the queue order is the order named.
            for (name, release) in [
                ("first-call", false),
                ("release", true),
                ("second-call", false),
            ] {
                let (queued, was_queued) = mpsc::channel();
                let entry = Arc::clone(&log);
                let work = move || entry.lock().expect("log").push(name);
                let task = if release {
                    UiThreadTask::new_release(work)
                } else {
                    UiThreadTask::new(work)
                };
                let queue = Arc::clone(&posted);
                scope.spawn(move || {
                    let _ = queue.post_and_wait(&task, || {
                        queued.send(()).expect("announce the post");
                        Ok(())
                    });
                });
                was_queued
                    .recv_timeout(Duration::from_secs(5))
                    .expect("the task must be queued");
            }

            posted.drain_releases();
            assert_eq!(*log.lock().expect("log"), ["release"]);

            posted.drain();
            assert_eq!(
                *log.lock().expect("log"),
                ["release", "first-call", "second-call"],
                "the tasks the releases-only drain skipped keep their order"
            );
        });
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

    fn marked_when_run() -> (Arc<UiThreadTask>, Arc<AtomicBool>) {
        let ran = Arc::new(AtomicBool::new(false));
        let marker = Arc::clone(&ran);
        (
            UiThreadTask::new(move || marker.store(true, Ordering::Release)),
            ran,
        )
    }

    /// The reason the wait is bounded at all. A main thread parked on something
    /// else — a control gate whose holder is this very caller — never reaches
    /// the pump, and a caller that waited forever would hold that gate forever.
    ///
    /// Asserted from another thread on purpose: a caller that never gives up
    /// hangs rather than fails, and the failure has to be the missing answer.
    #[test]
    fn a_pump_that_never_runs_the_work_gives_up_inside_the_deadline() {
        let ui = Arc::new(PostedUiThread::new(Duration::from_millis(50)));
        let (task, ran) = marked_when_run();

        let posting = Arc::clone(&ui);
        let posted = Arc::clone(&task);
        let (answer, answered) = mpsc::channel();
        thread::spawn(move || {
            let _ = answer.send(posting.post_and_wait(&posted, || Ok(())));
        });

        let given_up = answered
            .recv_timeout(Duration::from_secs(5))
            .expect("a call whose pump never runs must give up rather than wait forever");

        assert!(
            given_up.is_err(),
            "work that never ran must be reported as work that never ran"
        );
        ui.drain();
        assert!(
            !ran.load(Ordering::Acquire),
            "withdrawn work must never run afterwards, or it writes through a borrow the caller has given back"
        );
    }

    /// The withdrawal race, from the side that loses it. The pump is *inside*
    /// the work when the deadline passes, so the caller must wait it out and
    /// report success — returning `Err` here would tell the caller its borrow is
    /// free while the UI thread is still writing through it.
    #[test]
    fn work_the_pump_started_before_the_deadline_is_waited_out_and_reported_as_run() {
        let ui = Arc::new(PostedUiThread::new(Duration::from_millis(50)));
        let (release, released) = mpsc::channel::<()>();
        let finished = Arc::new(AtomicBool::new(false));
        let marker = Arc::clone(&finished);
        let task = UiThreadTask::new(move || {
            // Still running when the caller's deadline passes, which is the
            // whole race.
            let _ = released.recv();
            marker.store(true, Ordering::Release);
        });
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(150));
            let _ = release.send(());
        });

        let pumping = Arc::clone(&ui);
        let answer = ui.post_and_wait(&task, move || {
            thread::spawn(move || pumping.drain());
            Ok(())
        });

        assert!(
            finished.load(Ordering::Acquire),
            "the caller must not come back while the UI thread is still inside the work"
        );
        assert_eq!(
            answer,
            Ok(()),
            "work the UI thread ran is work that ran, whatever the wait did"
        );
    }

    /// A pump that took the work and only then reported itself unreachable did
    /// the work. Answering `Err` would have the caller treat a completed editor
    /// call as one that never happened.
    #[test]
    fn a_wake_that_fails_after_the_work_already_ran_reports_success() {
        let ui = PostedUiThread::new(Duration::from_secs(5));
        let (task, ran) = marked_when_run();

        let answer = ui.post_and_wait(&task, || {
            ui.drain();
            Err(UiThreadError::Shell("the shell's loop is gone".to_string()))
        });

        assert!(ran.load(Ordering::Acquire), "the pump ran the work");
        assert_eq!(
            answer,
            Ok(()),
            "a wake that failed after the work ran did not lose the work"
        );
    }

    /// The other side of the same branch: a pump that never took the work is a
    /// real failure, and the work must be gone by the time it is reported.
    #[test]
    fn a_wake_that_fails_before_the_work_runs_reports_the_failure_and_withdraws_it() {
        let ui = PostedUiThread::new(Duration::from_secs(5));
        let (task, ran) = marked_when_run();

        let answer = ui.post_and_wait(&task, || {
            Err(UiThreadError::Shell("the shell's loop is gone".to_string()))
        });

        assert_eq!(
            answer,
            Err(UiThreadError::Shell("the shell's loop is gone".to_string()))
        );
        assert_eq!(answer.unwrap_err().to_string(), "the shell's loop is gone");
        ui.drain();
        assert!(
            !ran.load(Ordering::Acquire),
            "work reported as never having run must not run on a later pass"
        );
    }

    /// A value whose drop records the thread that ran it, standing in for a
    /// plugin runtime whose drop is the plugin's own teardown.
    struct DropRecorder(Arc<Mutex<Vec<ThreadId>>>);

    impl Drop for DropRecorder {
        fn drop(&mut self) {
            self.0
                .lock()
                .expect("drop log")
                .push(thread::current().id());
        }
    }

    /// The release's whole purpose: the drop happens on the UI thread, not on
    /// the caller's.
    #[test]
    fn a_released_value_is_dropped_on_the_ui_thread() {
        let ui = DedicatedUiThread::start();
        let dropped_on = Arc::new(Mutex::new(Vec::new()));

        release_on_ui_thread(&ui, DropRecorder(Arc::clone(&dropped_on)))
            .map_err(|(_, reason)| reason)
            .expect("the release runs");

        assert_ne!(ui.thread_id, thread::current().id());
        assert_eq!(*dropped_on.lock().expect("drop log"), [ui.thread_id]);
    }

    /// A hop that never lands must hand the value back undropped. Withdrawing
    /// a closure that owned it would drop it right here, on the caller's
    /// thread — the very teardown the release exists to move.
    #[test]
    fn a_release_whose_hop_never_lands_hands_the_value_back_undropped() {
        struct Refusing;
        impl UiThread for Refusing {
            fn is_ui_thread(&self) -> bool {
                false
            }
            fn run_on_ui_thread(&self, _task: &Arc<UiThreadTask>) -> Result<(), UiThreadError> {
                Err(UiThreadError::Shell("the shell's loop is gone".to_string()))
            }
        }
        let dropped_on = Arc::new(Mutex::new(Vec::new()));

        let (value, reason) =
            release_on_ui_thread(&Refusing, DropRecorder(Arc::clone(&dropped_on)))
                .expect_err("a refused hop cannot have released anything");

        assert_eq!(
            reason,
            UiThreadError::Shell("the shell's loop is gone".to_string())
        );
        assert_eq!(reason.to_string(), "the shell's loop is gone");
        assert!(
            dropped_on.lock().expect("drop log").is_empty(),
            "the value must come back whole, not be dropped on the way"
        );
        drop(value);
    }
}
