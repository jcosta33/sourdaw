//! The `IRunLoop` a VST3 editor is given on X11.
//!
//! On Linux a VST3 editor does not run at all unless the host answers
//! `IPlugFrame::queryInterface(IRunLoop)`: the plugin has no event loop of its
//! own there, so it hands the host the file descriptor of its X11 connection and
//! the timers its animation needs, and waits to be called back. A host that
//! refuses the query leaves an attached editor that never draws and never
//! responds.
//!
//! `IRunLoop` exists so those callbacks run on the host's UI event loop — the
//! thread that owns the editor's X11 window — so that is where they run. A
//! [`HostRunLoop`] is the registry and the dispatcher for one editor;
//! [`service_editor_run_loops`] is one pass over every open editor's, and the
//! shell calls it from its own event loop.
//!
//! A pass therefore never waits: it fires the timers that are due, hands each
//! readable descriptor to its handler, and returns. The thread it runs on is
//! the one that has to keep drawing, so what paces the loop is the shell's own
//! turn rate rather than anything decided here — which is also the ceiling on
//! how fast a plugin's timer can be served.
//!
//! Nothing here is reachable from the audio thread.

use std::collections::HashSet;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use vst3::Steinberg::Linux::{
    FileDescriptor, IEventHandler, IEventHandlerTrait, ITimerHandler, ITimerHandlerTrait,
    TimerInterval,
};
use vst3::Steinberg::{kInvalidArgument, kResultFalse, kResultOk, tresult};
use vst3::{ComPtr, ComRef};

use crate::vst3_editor::com_identity;

/// The floor a plugin's requested timer interval is held to.
///
/// A plugin asking for a 0 ms timer is asking to be called as fast as the host
/// can manage, which on a shared machine is a spin. Every established host
/// clamps; 1 ms is below any editor's real animation rate.
const MIN_TIMER_INTERVAL: Duration = Duration::from_millis(1);

/// One editor file descriptor and the handler waiting on it.
struct EventHandlerRegistration {
    handler: ComPtr<IEventHandler>,
    identity: HandlerIdentity,
    descriptor: FileDescriptor,
}

/// One editor timer.
struct TimerRegistration {
    handler: ComPtr<ITimerHandler>,
    identity: HandlerIdentity,
    interval: Duration,
    due: Instant,
}

/// The address of a handler's `FUnknown`, which is where COM defines identity.
///
/// Recorded at registration and compared on unregistration, because a plugin is
/// entitled to hand `unregister` a different interface pointer to the same
/// object than `register` was given — multiple inheritance alone produces one —
/// and comparing the interface pointers would leave the handler registered for
/// ever, firing into an editor that has finished with it.
///
/// Kept as a number rather than a pointer so it compares without dereferencing
/// anything and leaves the registry thread-safe.
type HandlerIdentity = usize;

/// One event-handler registration, named by what does not change under it: the
/// handler's identity and the descriptor it was registered on. The pair, not the
/// descriptor alone, because a descriptor number is reused as soon as it is
/// closed and the same handler may watch more than one.
type DeadRegistration = (HandlerIdentity, FileDescriptor);

/// Ask an interface pointer for the object behind it.
///
/// A `queryInterface` call into plugin code, so every caller takes it before
/// locking the registry and stores the answer — the lock is never held across a
/// call the plugin implements.
///
/// # Safety
/// `pointer` is an argument of an `IRunLoop` call, so it is either null or a
/// live interface of the named type.
unsafe fn handler_identity<I: vst3::Interface>(pointer: *mut I) -> Option<HandlerIdentity> {
    com_identity(pointer).map(|identity| identity as HandlerIdentity)
}

#[derive(Default)]
struct Registry {
    event_handlers: Vec<EventHandlerRegistration>,
    timers: Vec<TimerRegistration>,
}

/// The registered editor descriptors and timers, and the dispatch that services
/// them.
#[derive(Default)]
pub struct HostRunLoop {
    registry: Mutex<Registry>,
    /// Held for the whole of one pass, and taken again by the close.
    ///
    /// A pass calls into handlers this editor owns, so the editor may not
    /// release them while one is running. Uncontended whenever the shell's pump
    /// and the editor's close are the same thread, which is the arrangement the
    /// whole editor lifecycle now keeps; the lock is what makes the other
    /// arrangement — a runtime retired off that thread with its editor still
    /// open — wait rather than free a handler mid-call.
    pass: Mutex<()>,
}

impl HostRunLoop {
    pub fn new() -> Self {
        Self::default()
    }

    /// Take ownership of a raw plugin-supplied interface pointer.
    ///
    /// The plugin hands a borrowed pointer and keeps its own reference; the host
    /// retains for as long as it holds the registration, which is what `ComRef`
    /// to `ComPtr` does.
    ///
    /// # Safety
    /// `pointer` is the argument of an `IRunLoop` call, so it is either null or
    /// a live interface of the named type.
    unsafe fn retain<I: vst3::Interface>(pointer: *mut I) -> Option<ComPtr<I>> {
        ComRef::from_raw(pointer).map(|borrowed| borrowed.to_com_ptr())
    }

    /// # Safety
    /// `handler` is the pointer the plugin passed to `registerEventHandler`.
    pub unsafe fn register_event_handler(
        &self,
        handler: *mut IEventHandler,
        descriptor: FileDescriptor,
    ) -> tresult {
        if descriptor < 0 {
            return kInvalidArgument;
        }
        let Some(handler) = Self::retain(handler) else {
            return kInvalidArgument;
        };
        let Some(identity) = handler_identity(handler.as_ptr()) else {
            return kInvalidArgument;
        };
        let mut registry = self.lock();
        registry.event_handlers.push(EventHandlerRegistration {
            handler,
            identity,
            descriptor,
        });
        kResultOk
    }

    /// # Safety
    /// `handler` is the pointer the plugin passed to `unregisterEventHandler`.
    pub unsafe fn unregister_event_handler(&self, handler: *mut IEventHandler) -> tresult {
        let Some(identity) = handler_identity(handler) else {
            return kInvalidArgument;
        };
        let mut registry = self.lock();
        let before = registry.event_handlers.len();
        registry
            .event_handlers
            .retain(|registration| registration.identity != identity);
        removal_result(before, registry.event_handlers.len())
    }

    /// # Safety
    /// `handler` is the pointer the plugin passed to `registerTimer`.
    pub unsafe fn register_timer(
        &self,
        handler: *mut ITimerHandler,
        milliseconds: TimerInterval,
    ) -> tresult {
        let Some(handler) = Self::retain(handler) else {
            return kInvalidArgument;
        };
        let Some(identity) = handler_identity(handler.as_ptr()) else {
            return kInvalidArgument;
        };
        let interval = Duration::from_millis(milliseconds).max(MIN_TIMER_INTERVAL);
        let mut registry = self.lock();
        registry.timers.push(TimerRegistration {
            handler,
            identity,
            interval,
            due: Instant::now() + interval,
        });
        kResultOk
    }

    /// # Safety
    /// `handler` is the pointer the plugin passed to `unregisterTimer`.
    pub unsafe fn unregister_timer(&self, handler: *mut ITimerHandler) -> tresult {
        let Some(identity) = handler_identity(handler) else {
            return kInvalidArgument;
        };
        let mut registry = self.lock();
        let before = registry.timers.len();
        registry
            .timers
            .retain(|registration| registration.identity != identity);
        removal_result(before, registry.timers.len())
    }

    /// Fire every timer due at `now` and return how many fired.
    ///
    /// The handlers are taken out from under the lock before any of them is
    /// called: `onTimer` is editor code, and an editor that registers or
    /// unregisters from inside its own callback would otherwise deadlock against
    /// the registry it is already inside.
    pub fn service_timers(&self, now: Instant) -> usize {
        let due = {
            let mut registry = self.lock();
            let mut due = Vec::new();
            for timer in registry.timers.iter_mut() {
                if timer.due > now {
                    continue;
                }
                // Scheduled from `now` rather than from the missed deadline, so a
                // pass that ran late does not then fire the same timer repeatedly
                // to catch up.
                timer.due = now + timer.interval;
                due.push(timer.handler.clone());
            }
            due
        };

        for handler in &due {
            // SAFETY: the handler is retained by this registration and the call
            // is made off the audio thread.
            unsafe { handler.onTimer() };
        }
        due.len()
    }

    /// One pass of the loop: fire every timer that is due, then hand each
    /// readable descriptor to its handler. Returns how many handlers were
    /// called.
    ///
    /// Never waits. This runs on the shell's UI thread, so a pass that blocked
    /// would stop the editor it is servicing from drawing.
    pub fn service_once(&self) -> usize {
        let _pass = self
            .pass
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        self.service_timers(Instant::now()) + self.service_file_descriptors()
    }

    /// Hand every registered descriptor that is readable right now to its
    /// handler. Returns how many handlers were called.
    ///
    /// Handlers are taken out from under the lock for the same reason timers
    /// are, and the registry is read again after the poll: a descriptor
    /// unregistered from inside a handler may already be closed, and its number
    /// reused by something else in this process.
    pub fn service_file_descriptors(&self) -> usize {
        let watched = self.watched_descriptors();
        if watched.is_empty() {
            return 0;
        }

        let polled = poll_descriptors(&watched);
        // Which registrations the dead descriptors belong to is settled before
        // the dispatch, and the dispatch's own wakes decide nothing about it.
        let doomed = self.registrations_on(&polled.dead);
        // Woken first, forgotten second. A descriptor that hung up is in both
        // sets, and forgetting its registration first would take the handler out
        // of the registry the dispatch reads — swallowing the very last wake a
        // dying connection is owed.
        let dispatched = self.dispatch_ready(&polled.ready);
        self.drop_registrations(&doomed);
        dispatched
    }

    fn watched_descriptors(&self) -> Vec<FileDescriptor> {
        let registry = self.lock();
        registry
            .event_handlers
            .iter()
            .map(|registration| registration.descriptor)
            .collect()
    }

    /// Call every handler still registered on a ready descriptor.
    ///
    /// Every one of them: two handlers may share a descriptor, and waking only
    /// the first leaves the second's editor deaf for as long as both are
    /// registered.
    fn dispatch_ready(&self, ready: &HashSet<FileDescriptor>) -> usize {
        if ready.is_empty() {
            return 0;
        }
        let due: Vec<(ComPtr<IEventHandler>, FileDescriptor)> = {
            let registry = self.lock();
            registry
                .event_handlers
                .iter()
                .filter(|registration| ready.contains(&registration.descriptor))
                .map(|registration| (registration.handler.clone(), registration.descriptor))
                .collect()
        };

        for (handler, descriptor) in &due {
            // SAFETY: the handler is retained by this registration and the call
            // is made off the audio thread.
            unsafe { handler.onFDIsSet(*descriptor) };
        }
        due.len()
    }

    /// Which registrations are on these descriptors right now.
    ///
    /// Named rather than counted, because a descriptor number is not a lasting
    /// name for anything: the moment one is closed the kernel is free to hand
    /// the same number back for the next thing opened.
    fn registrations_on(&self, descriptors: &HashSet<FileDescriptor>) -> HashSet<DeadRegistration> {
        if descriptors.is_empty() {
            return HashSet::new();
        }
        let registry = self.lock();
        registry
            .event_handlers
            .iter()
            .filter(|registration| descriptors.contains(&registration.descriptor))
            .map(|registration| (registration.identity, registration.descriptor))
            .collect()
    }

    /// Forget exactly these registrations, because the descriptors they are on
    /// will never be readable again. Keeping one is not politeness: its
    /// `revents` are sticky, so every later `poll` returns immediately on it.
    ///
    /// By registration, never by descriptor number. A plugin is entitled to act
    /// on the wake it was just given: unregister, close the connection,
    /// reconnect, and register a new handler — and the reconnection is handed
    /// the lowest free descriptor number, which is the one it just released.
    /// Forgetting by number would retain that new registration out and leave the
    /// reconnected editor silently deaf.
    fn drop_registrations(&self, doomed: &HashSet<DeadRegistration>) {
        if doomed.is_empty() {
            return;
        }
        let mut registry = self.lock();
        registry.event_handlers.retain(|registration| {
            !doomed.contains(&(registration.identity, registration.descriptor))
        });
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Registry> {
        self.registry
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// `kResultOk` when something was removed, `kResultFalse` when the handler was
/// not registered. VST3 callers treat a false here as "already gone", which is
/// the truth, where `kResultOk` would claim a removal that never happened.
fn removal_result(before: usize, after: usize) -> tresult {
    if after < before {
        kResultOk
    } else {
        kResultFalse
    }
}

/// What one `poll` said about the descriptors it was given.
#[derive(Debug, Default, PartialEq, Eq)]
struct PolledDescriptors {
    /// Readable, or ended and owed one last wake.
    ready: HashSet<FileDescriptor>,
    /// Will never be readable again, and must not be polled again.
    dead: HashSet<FileDescriptor>,
}

/// Ask which of `descriptors` are readable right now, and which of them have
/// ended.
fn poll_descriptors(descriptors: &[FileDescriptor]) -> PolledDescriptors {
    let mut poll_fds: Vec<libc::pollfd> = descriptors
        .iter()
        .map(|descriptor| libc::pollfd {
            fd: *descriptor,
            events: libc::POLLIN,
            revents: 0,
        })
        .collect();

    // Zero timeout: `poll` answers what is ready and returns. A pass on the UI
    // thread has no time to wait in.
    // SAFETY: `poll_fds` is a live, correctly sized array of `pollfd`, and the
    // length is its own element count.
    let ready = unsafe { libc::poll(poll_fds.as_mut_ptr(), poll_fds.len() as libc::nfds_t, 0) };
    if ready <= 0 {
        return PolledDescriptors::default();
    }

    let mut polled = PolledDescriptors::default();
    for poll_fd in &poll_fds {
        // `POLLNVAL` is the kernel refusing the descriptor outright — it is not
        // open in this process. There is nothing for a handler to read and
        // nothing to wake it about, and polling it again returns instantly, so
        // it is dropped without a wake.
        if poll_fd.revents & libc::POLLNVAL != 0 {
            polled.dead.insert(poll_fd.fd);
            continue;
        }
        if poll_fd.revents & libc::POLLIN != 0 {
            polled.ready.insert(poll_fd.fd);
        }
        // `POLLERR`/`POLLHUP` earn one last wake: a plugin whose connection died
        // has to be told, and it learns that from the read it makes in its own
        // handler. Silently withholding the wake leaves it waiting forever. They
        // are also the end of the descriptor and they are sticky, so the
        // registration goes with the wake rather than reporting for ever.
        if poll_fd.revents & (libc::POLLERR | libc::POLLHUP) != 0 {
            polled.ready.insert(poll_fd.fd);
            polled.dead.insert(poll_fd.fd);
        }
    }
    polled
}

/// Every open editor's run loop, in the order the editors opened.
///
/// Process-wide because what pumps it is: one UI thread serves every editor
/// this host has open, and the alternative — carrying a run-loop host down
/// through `AudioPlugin::open_gui` — would put a platform's event loop into a
/// seam that is deliberately shell-independent.
static EDITOR_RUN_LOOPS: Mutex<Vec<(EditorRunLoopId, Arc<HostRunLoop>)>> = Mutex::new(Vec::new());

/// Names one editor's registration, so a close removes its own and no other.
type EditorRunLoopId = u64;

/// One editor's place in the pumped set, given up when the editor closes.
pub struct EditorRunLoopRegistration {
    id: EditorRunLoopId,
    run_loop: Arc<HostRunLoop>,
}

fn editor_run_loops() -> std::sync::MutexGuard<'static, Vec<(EditorRunLoopId, Arc<HostRunLoop>)>> {
    EDITOR_RUN_LOOPS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Ask the host's UI loop to start servicing this editor.
pub fn register_editor_run_loop(run_loop: Arc<HostRunLoop>) -> EditorRunLoopRegistration {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    let id = NEXT.fetch_add(1, Ordering::Relaxed);
    editor_run_loops().push((id, Arc::clone(&run_loop)));
    EditorRunLoopRegistration { id, run_loop }
}

impl Drop for EditorRunLoopRegistration {
    /// Leave the pumped set, then wait out a pass already inside this loop.
    ///
    /// The wait is what the private service thread's `join` used to be: a pass
    /// calls into handlers the editor is about to release, so the close may not
    /// return while one is running.
    fn drop(&mut self) {
        editor_run_loops().retain(|(id, _)| *id != self.id);
        let _pass = self
            .run_loop
            .pass
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
    }
}

/// One pass over every open editor's run loop. Returns how many handlers were
/// called.
///
/// The shell calls this from its own event loop, which is the thread that owns
/// the editor windows — the thread `IRunLoop` exists to deliver these callbacks
/// on. The registry is copied out before any of them runs: `onTimer` and
/// `onFDIsSet` are editor code, and an editor that closes from inside its own
/// callback would otherwise deadlock against the registry it is already inside.
pub fn service_editor_run_loops() -> usize {
    let open: Vec<Arc<HostRunLoop>> = editor_run_loops()
        .iter()
        .map(|(_, run_loop)| Arc::clone(run_loop))
        .collect();

    open.iter().map(|run_loop| run_loop.service_once()).sum()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;
    use vst3::{Class, ComWrapper};

    /// A plugin's timer handler, counting the wakes it was given.
    #[derive(Default)]
    struct CountingTimerHandler {
        wakes: AtomicUsize,
    }

    impl Class for CountingTimerHandler {
        type Interfaces = (ITimerHandler,);
    }

    impl ITimerHandlerTrait for CountingTimerHandler {
        unsafe fn onTimer(&self) {
            self.wakes.fetch_add(1, Ordering::AcqRel);
        }
    }

    /// A plugin's event handler, recording the descriptors it was woken for.
    #[derive(Default)]
    struct RecordingEventHandler {
        woken_for: Mutex<Vec<FileDescriptor>>,
    }

    impl Class for RecordingEventHandler {
        type Interfaces = (IEventHandler,);
    }

    impl IEventHandlerTrait for RecordingEventHandler {
        unsafe fn onFDIsSet(&self, fd: FileDescriptor) {
            self.woken_for
                .lock()
                .expect("descriptor log mutex")
                .push(fd);
        }
    }

    /// A descriptor number nothing in this process has open, so `poll` answers
    /// `POLLNVAL` for it — what a plugin that closed its connection without
    /// unregistering leaves behind. Far above any number the runtime can hand
    /// out, so no concurrently running test can make it valid again.
    const NEVER_OPEN_DESCRIPTOR: FileDescriptor = 1_000_000;

    /// A pipe whose read end a test registers and whose write end it makes
    /// readable on demand.
    struct Pipe {
        read: FileDescriptor,
        write: FileDescriptor,
    }

    impl Pipe {
        fn open() -> Self {
            let mut ends: [libc::c_int; 2] = [0; 2];
            // SAFETY: `ends` is a live two-element array, which is what `pipe`
            // documents its argument to be.
            let created = unsafe { libc::pipe(ends.as_mut_ptr()) };
            assert_eq!(created, 0, "the test pipe must open");
            Self {
                read: ends[0],
                write: ends[1],
            }
        }

        fn make_readable(&self) {
            let byte = b"x";
            // SAFETY: one byte from a live buffer onto an open descriptor.
            let written = unsafe { libc::write(self.write, byte.as_ptr().cast(), 1) };
            assert_eq!(written, 1, "the test pipe must accept a byte");
        }

        /// Close the writing end, which is what a plugin's connection dying
        /// looks like from the descriptor the host watches: the read end polls
        /// ready and hung up at once, for ever.
        fn hang_up(&mut self) {
            if self.write < 0 {
                return;
            }
            // SAFETY: the descriptor is open and owned by this value.
            unsafe { libc::close(self.write) };
            self.write = -1;
        }
    }

    impl Drop for Pipe {
        fn drop(&mut self) {
            self.hang_up();
            // SAFETY: the read descriptor is open and owned by this value.
            unsafe { libc::close(self.read) };
        }
    }

    /// A registered timer must actually be called, and calling it is the whole
    /// reason a Linux editor animates at all.
    #[test]
    fn a_registered_timer_fires_when_it_comes_due() {
        let run_loop = HostRunLoop::new();
        let handler = ComWrapper::new(CountingTimerHandler::default());
        let raw = handler
            .as_com_ref::<ITimerHandler>()
            .expect("the fake handler implements ITimerHandler")
            .as_ptr();

        // SAFETY: `raw` borrows a live handler this test owns.
        assert_eq!(unsafe { run_loop.register_timer(raw, 10) }, kResultOk);

        // Before the interval elapses nothing is due, so a pass that fired here
        // would be firing on registration rather than on time.
        assert_eq!(run_loop.service_timers(Instant::now()), 0);
        assert_eq!(
            run_loop.service_timers(Instant::now() + Duration::from_millis(10)),
            1
        );
        assert_eq!(handler.wakes.load(Ordering::Acquire), 1);
    }

    /// A timer the plugin has taken back must stop firing. A host that keeps
    /// calling one is calling into an object the editor has finished with.
    #[test]
    fn unregistering_a_timer_stops_it_firing() {
        let run_loop = HostRunLoop::new();
        let handler = ComWrapper::new(CountingTimerHandler::default());
        let raw = handler
            .as_com_ref::<ITimerHandler>()
            .expect("the fake handler implements ITimerHandler")
            .as_ptr();

        // SAFETY: `raw` borrows a live handler this test owns.
        unsafe {
            assert_eq!(run_loop.register_timer(raw, 10), kResultOk);
            assert_eq!(
                run_loop.service_timers(Instant::now() + Duration::from_millis(10)),
                1
            );
            assert_eq!(run_loop.unregister_timer(raw), kResultOk);
        }

        assert_eq!(
            run_loop.service_timers(Instant::now() + Duration::from_secs(1)),
            0,
            "an unregistered timer must not fire again"
        );
        assert_eq!(handler.wakes.load(Ordering::Acquire), 1);
    }

    /// The descriptor is the editor's own connection. A handler that is not
    /// called when it becomes readable is an editor that never processes an
    /// event.
    #[test]
    fn a_registered_event_handler_is_called_when_its_descriptor_is_readable() {
        let run_loop = HostRunLoop::new();
        let pipe = Pipe::open();
        let handler = ComWrapper::new(RecordingEventHandler::default());
        let raw = handler
            .as_com_ref::<IEventHandler>()
            .expect("the fake handler implements IEventHandler")
            .as_ptr();

        // SAFETY: `raw` borrows a live handler this test owns.
        assert_eq!(
            unsafe { run_loop.register_event_handler(raw, pipe.read) },
            kResultOk
        );

        // Nothing has been written, so a handler called here would be called on
        // registration rather than on readiness.
        assert_eq!(run_loop.service_file_descriptors(), 0);

        pipe.make_readable();
        assert_eq!(run_loop.service_file_descriptors(), 1);
        assert_eq!(
            *handler.woken_for.lock().expect("descriptor log mutex"),
            vec![pipe.read],
            "the handler must be told which descriptor woke it"
        );
    }

    /// A descriptor the plugin has taken back must stop waking it, even while
    /// the descriptor stays readable.
    #[test]
    fn unregistering_an_event_handler_stops_it_being_called() {
        let run_loop = HostRunLoop::new();
        let pipe = Pipe::open();
        let handler = ComWrapper::new(RecordingEventHandler::default());
        let raw = handler
            .as_com_ref::<IEventHandler>()
            .expect("the fake handler implements IEventHandler")
            .as_ptr();

        // SAFETY: `raw` borrows a live handler this test owns.
        unsafe {
            assert_eq!(run_loop.register_event_handler(raw, pipe.read), kResultOk);
            pipe.make_readable();
            assert_eq!(run_loop.service_file_descriptors(), 1);
            assert_eq!(run_loop.unregister_event_handler(raw), kResultOk);
        }

        assert_eq!(
            run_loop.service_file_descriptors(),
            0,
            "an unregistered handler must not be called again"
        );
        assert_eq!(
            handler
                .woken_for
                .lock()
                .expect("descriptor log mutex")
                .len(),
            1
        );
    }

    /// Two handlers may watch one descriptor — a plugin with two views on one
    /// X11 connection is the ordinary case. Waking only the one that registered
    /// first leaves the other's editor deaf for as long as both are registered.
    #[test]
    fn every_handler_registered_on_one_descriptor_is_woken() {
        let run_loop = HostRunLoop::new();
        let pipe = Pipe::open();
        let first = ComWrapper::new(RecordingEventHandler::default());
        let second = ComWrapper::new(RecordingEventHandler::default());

        for handler in [&first, &second] {
            let raw = handler
                .as_com_ref::<IEventHandler>()
                .expect("the fake handler implements IEventHandler")
                .as_ptr();
            // SAFETY: `raw` borrows a live handler this test owns.
            assert_eq!(
                unsafe { run_loop.register_event_handler(raw, pipe.read) },
                kResultOk
            );
        }

        pipe.make_readable();
        assert_eq!(
            run_loop.service_file_descriptors(),
            2,
            "both handlers on the ready descriptor must be called"
        );
        for handler in [&first, &second] {
            assert_eq!(
                *handler.woken_for.lock().expect("descriptor log mutex"),
                vec![pipe.read]
            );
        }
    }

    /// A plugin whose connection ends is owed one last wake: it learns the end
    /// from the read it makes inside its own handler, and a host that forgot the
    /// registration before dispatching would leave it waiting for an event that
    /// can never arrive. The registration goes immediately afterwards, because a
    /// hung-up descriptor polls ready for ever.
    #[test]
    fn a_descriptor_that_hangs_up_is_woken_once_and_then_forgotten() {
        let run_loop = HostRunLoop::new();
        let mut pipe = Pipe::open();
        let handler = ComWrapper::new(RecordingEventHandler::default());
        let raw = handler
            .as_com_ref::<IEventHandler>()
            .expect("the fake handler implements IEventHandler")
            .as_ptr();

        // SAFETY: `raw` borrows a live handler this test owns.
        assert_eq!(
            unsafe { run_loop.register_event_handler(raw, pipe.read) },
            kResultOk
        );

        pipe.hang_up();

        assert_eq!(
            run_loop.service_file_descriptors(),
            1,
            "the handler must be told the descriptor it waits on has ended"
        );
        assert_eq!(
            *handler.woken_for.lock().expect("descriptor log mutex"),
            vec![pipe.read]
        );

        assert_eq!(
            run_loop.service_file_descriptors(),
            0,
            "a hung-up descriptor must stop being dispatched, not wake for ever"
        );
        assert_eq!(
            handler
                .woken_for
                .lock()
                .expect("descriptor log mutex")
                .len(),
            1,
            "the last wake is one wake"
        );
        // SAFETY: `raw` borrows a live handler this test owns.
        assert_eq!(
            unsafe { run_loop.unregister_event_handler(raw) },
            kResultFalse,
            "the registry must no longer watch the ended descriptor"
        );
    }

    /// A plugin is entitled to act on the last wake it is given: unregister,
    /// close the connection, reconnect, and register a new handler. The kernel
    /// hands the reconnection the lowest free descriptor number, which is the
    /// one just released — so the pass that is about to forget the dead
    /// registration finds a live one wearing the same number. Forgetting by
    /// number takes the reconnected editor's handler with it and the editor goes
    /// deaf without a sound.
    #[test]
    fn a_registration_made_during_a_pass_survives_that_pass_forgetting_its_number() {
        let run_loop = HostRunLoop::new();
        let pipe = Pipe::open();
        let ending = ComWrapper::new(RecordingEventHandler::default());
        let reconnected = ComWrapper::new(RecordingEventHandler::default());
        let raw = |handler: &ComWrapper<RecordingEventHandler>| {
            handler
                .as_com_ref::<IEventHandler>()
                .expect("the fake handler implements IEventHandler")
                .as_ptr()
        };

        // SAFETY: both raw pointers borrow live handlers this test owns.
        unsafe {
            assert_eq!(
                run_loop.register_event_handler(raw(&ending), pipe.read),
                kResultOk
            );

            // What the pass settles before it dispatches: the registration that
            // was on the descriptor when `poll` reported it dead.
            let doomed = run_loop.registrations_on(&HashSet::from([pipe.read]));

            // What the plugin does while being dispatched: a new handler appears
            // on the same descriptor number.
            assert_eq!(
                run_loop.register_event_handler(raw(&reconnected), pipe.read),
                kResultOk
            );

            run_loop.drop_registrations(&doomed);

            assert_eq!(
                run_loop.unregister_event_handler(raw(&ending)),
                kResultFalse,
                "the registration the pass found dead must be gone"
            );
            assert_eq!(
                run_loop.unregister_event_handler(raw(&reconnected)),
                kResultOk,
                "the registration made during the pass must have survived it"
            );
        }
    }

    /// A descriptor the kernel refuses is never readable and never will be, and
    /// `poll` returns on it instantly for ever. Keeping the registration means
    /// every later pass dispatches nothing and reports the same descriptor
    /// again, so the registration goes on the pass that first sees it refused.
    #[test]
    fn a_descriptor_the_kernel_refuses_is_dropped_rather_than_polled_for_ever() {
        let run_loop = HostRunLoop::new();
        let handler = ComWrapper::new(RecordingEventHandler::default());
        let raw = handler
            .as_com_ref::<IEventHandler>()
            .expect("the fake handler implements IEventHandler")
            .as_ptr();

        // SAFETY: `raw` borrows a live handler this test owns.
        assert_eq!(
            unsafe { run_loop.register_event_handler(raw, NEVER_OPEN_DESCRIPTOR) },
            kResultOk
        );

        assert_eq!(run_loop.service_file_descriptors(), 0);

        // SAFETY: `raw` borrows a live handler this test owns.
        assert_eq!(
            unsafe { run_loop.unregister_event_handler(raw) },
            kResultFalse,
            "the refused descriptor's registration must already be gone"
        );
        assert!(
            handler
                .woken_for
                .lock()
                .expect("descriptor log mutex")
                .is_empty(),
            "a descriptor that was never open has nothing for a handler to read"
        );
    }

    /// The whole point of the registration: an editor's timers and descriptors
    /// are serviced by the host's own UI loop, and a pass that skipped a
    /// registered loop would leave that editor frozen on screen.
    #[test]
    fn an_open_editors_run_loop_is_serviced_by_the_host_pump() {
        let run_loop = Arc::new(HostRunLoop::new());
        let handler = ComWrapper::new(CountingTimerHandler::default());
        let raw = handler
            .as_com_ref::<ITimerHandler>()
            .expect("the fake handler implements ITimerHandler")
            .as_ptr();
        // SAFETY: `raw` borrows a live handler this test owns.
        assert_eq!(unsafe { run_loop.register_timer(raw, 0) }, kResultOk);

        let registration = register_editor_run_loop(Arc::clone(&run_loop));
        std::thread::sleep(MIN_TIMER_INTERVAL * 4);
        service_editor_run_loops();

        assert!(
            handler.wakes.load(Ordering::Acquire) > 0,
            "a registered editor's timer must fire on the host's pump"
        );
        drop(registration);
    }

    /// A closed editor's handlers are released, so a pass that still reached
    /// them would be calling into an object the editor has finished with.
    #[test]
    fn a_closed_editors_run_loop_is_no_longer_pumped() {
        let run_loop = Arc::new(HostRunLoop::new());
        let handler = ComWrapper::new(CountingTimerHandler::default());
        let raw = handler
            .as_com_ref::<ITimerHandler>()
            .expect("the fake handler implements ITimerHandler")
            .as_ptr();
        // SAFETY: `raw` borrows a live handler this test owns.
        assert_eq!(unsafe { run_loop.register_timer(raw, 0) }, kResultOk);

        drop(register_editor_run_loop(Arc::clone(&run_loop)));
        let wakes_at_close = handler.wakes.load(Ordering::Acquire);

        std::thread::sleep(MIN_TIMER_INTERVAL * 4);
        service_editor_run_loops();

        assert_eq!(
            handler.wakes.load(Ordering::Acquire),
            wakes_at_close,
            "an editor that gave up its registration must not be serviced again"
        );
    }

    /// Unregistering something that was never registered has removed nothing,
    /// and saying `kResultOk` would claim otherwise.
    #[test]
    fn unregistering_an_unknown_handler_reports_that_nothing_was_removed() {
        let run_loop = HostRunLoop::new();
        let timer = ComWrapper::new(CountingTimerHandler::default());
        let raw = timer
            .as_com_ref::<ITimerHandler>()
            .expect("the fake handler implements ITimerHandler")
            .as_ptr();

        // SAFETY: `raw` borrows a live handler this test owns.
        assert_eq!(unsafe { run_loop.unregister_timer(raw) }, kResultFalse);
    }
}
