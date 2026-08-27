//! The `IRunLoop` a VST3 editor is given on X11.
//!
//! On Linux a VST3 editor does not run at all unless the host answers
//! `IPlugFrame::queryInterface(IRunLoop)`: the plugin has no event loop of its
//! own there, so it hands the host the file descriptor of its X11 connection and
//! the timers its animation needs, and waits to be called back. A host that
//! refuses the query leaves an attached editor that never draws and never
//! responds.
//!
//! This type is the registry and the dispatcher; [`RunLoopService`] is the
//! thread that drives it. They are split because the driving is the part a host
//! with its own UI loop would replace: [`HostRunLoop::service_once`] is the
//! whole of one pass, and a shell that owns an event thread can call it from
//! there instead of letting the service thread run. Sourdaw's plugin-host crate has no UI thread of its own — the native
//! editor window belongs to the desktop shell — so the service thread is what
//! makes registered handlers fire today, and the split is what lets that change
//! without touching the registry.
//!
//! Nothing here is reachable from the audio thread.

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use vst3::Steinberg::Linux::{
    FileDescriptor, IEventHandler, IEventHandlerTrait, ITimerHandler, ITimerHandlerTrait,
    TimerInterval,
};
use vst3::Steinberg::{kInvalidArgument, kResultFalse, kResultOk, tresult};
use vst3::{ComPtr, ComRef};

use crate::vst3_editor::com_identity;

/// The longest one service pass waits on the registered descriptors before
/// looking at the timers again.
///
/// A ceiling on how long a pass may block rather than a poll interval: a pass
/// returns as soon as any descriptor is readable, and it never waits past the
/// next timer that comes due, so an idle editor costs nothing and a timer is
/// never held back by this number.
const SERVICE_POLL_SLICE: Duration = Duration::from_millis(16);

/// The floor a plugin's requested timer interval is held to.
///
/// A plugin asking for a 0 ms timer is asking to be called as fast as the host
/// can manage, which on a shared machine is a spin. Every established host
/// clamps; 1 ms is below any editor's real animation rate.
const MIN_TIMER_INTERVAL: Duration = Duration::from_millis(1);

/// One editor file descriptor and the handler waiting on it.
struct EventHandlerRegistration {
    handler: ComPtr<IEventHandler>,
    descriptor: FileDescriptor,
}

/// One editor timer.
struct TimerRegistration {
    handler: ComPtr<ITimerHandler>,
    interval: Duration,
    due: Instant,
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

    /// Whether two COM pointers name the same object.
    ///
    /// Compared on `FUnknown`, where COM defines identity: a plugin is entitled
    /// to hand `unregister` a different interface pointer to the same object
    /// than `register` was given — multiple inheritance alone produces one — and
    /// comparing the interface pointers would then leave the handler registered
    /// for ever, firing into an editor that has finished with it.
    fn same_object<I: vst3::Interface>(left: &ComPtr<I>, right: *mut I) -> bool {
        // SAFETY: `left` is retained by this registration, and `right` is the
        // pointer the plugin passed into the call being served.
        let (left, right) = unsafe { (com_identity(left.as_ptr()), com_identity(right)) };
        match (left, right) {
            (Some(left), Some(right)) => std::ptr::eq(left.cast_const(), right.cast_const()),
            _ => false,
        }
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
        let mut registry = self.lock();
        registry.event_handlers.push(EventHandlerRegistration {
            handler,
            descriptor,
        });
        kResultOk
    }

    /// # Safety
    /// `handler` is the pointer the plugin passed to `unregisterEventHandler`.
    pub unsafe fn unregister_event_handler(&self, handler: *mut IEventHandler) -> tresult {
        if handler.is_null() {
            return kInvalidArgument;
        }
        let mut registry = self.lock();
        let before = registry.event_handlers.len();
        registry
            .event_handlers
            .retain(|registration| !Self::same_object(&registration.handler, handler));
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
        let interval = Duration::from_millis(milliseconds).max(MIN_TIMER_INTERVAL);
        let mut registry = self.lock();
        registry.timers.push(TimerRegistration {
            handler,
            interval,
            due: Instant::now() + interval,
        });
        kResultOk
    }

    /// # Safety
    /// `handler` is the pointer the plugin passed to `unregisterTimer`.
    pub unsafe fn unregister_timer(&self, handler: *mut ITimerHandler) -> tresult {
        if handler.is_null() {
            return kInvalidArgument;
        }
        let mut registry = self.lock();
        let before = registry.timers.len();
        registry
            .timers
            .retain(|registration| !Self::same_object(&registration.handler, handler));
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

    /// How long a pass may block before the next registered timer comes due.
    ///
    /// Bounded above by [`SERVICE_POLL_SLICE`] so a loop with no timers still
    /// wakes, and below by [`MIN_TIMER_INTERVAL`] so a timer already overdue
    /// asks for a zero-length wait — which is a spin, not a poll.
    pub fn service_slice(&self, now: Instant) -> Duration {
        self.time_until_next_timer(now)
            .map_or(SERVICE_POLL_SLICE, |until| {
                until.clamp(MIN_TIMER_INTERVAL, SERVICE_POLL_SLICE)
            })
    }

    fn time_until_next_timer(&self, now: Instant) -> Option<Duration> {
        let registry = self.lock();
        registry
            .timers
            .iter()
            .map(|timer| timer.due.saturating_duration_since(now))
            .min()
    }

    /// One pass of the loop: fire what is due, then wait for a descriptor no
    /// longer than the next timer allows.
    pub fn service_once(&self) {
        let now = Instant::now();
        self.service_timers(now);
        self.service_file_descriptors(self.service_slice(now));
    }

    /// Wait up to `timeout` for any registered descriptor to become readable and
    /// hand each ready one to its handler. Returns how many handlers were called.
    ///
    /// A pass always either blocks in `poll` or sleeps. A descriptor the kernel
    /// refuses returns from `poll` instantly and for ever, so a pass that could
    /// return without waiting would spin a core for as long as the editor is
    /// open.
    ///
    /// Handlers are taken out from under the lock for the same reason timers are,
    /// and the registry is read again after the wait: a descriptor unregistered
    /// while `poll` was blocked may already be closed, and its number reused by
    /// something else in this process.
    pub fn service_file_descriptors(&self, timeout: Duration) -> usize {
        let started = Instant::now();
        let watched = self.watched_descriptors();
        if watched.is_empty() {
            std::thread::sleep(timeout);
            return 0;
        }

        let polled = poll_descriptors(&watched, timeout);
        self.drop_registrations_for(&polled.dead);

        let dispatched = self.dispatch_ready(&polled.ready);
        if dispatched == 0 {
            sleep_remainder(timeout, started.elapsed());
        }
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

    /// Forget the registrations on descriptors that will never be readable
    /// again. Keeping one is not politeness: its `revents` are sticky, so every
    /// later `poll` returns immediately on it.
    fn drop_registrations_for(&self, dead: &HashSet<FileDescriptor>) {
        if dead.is_empty() {
            return;
        }
        let mut registry = self.lock();
        registry
            .event_handlers
            .retain(|registration| !dead.contains(&registration.descriptor));
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

/// Wait up to `timeout` for any of `descriptors` to become readable, and report
/// which of them ended while waiting.
fn poll_descriptors(descriptors: &[FileDescriptor], timeout: Duration) -> PolledDescriptors {
    let mut poll_fds: Vec<libc::pollfd> = descriptors
        .iter()
        .map(|descriptor| libc::pollfd {
            fd: *descriptor,
            events: libc::POLLIN,
            revents: 0,
        })
        .collect();

    let milliseconds = i32::try_from(timeout.as_millis()).unwrap_or(i32::MAX);
    // SAFETY: `poll_fds` is a live, correctly sized array of `pollfd`, and the
    // length is its own element count.
    let ready = unsafe {
        libc::poll(
            poll_fds.as_mut_ptr(),
            poll_fds.len() as libc::nfds_t,
            milliseconds,
        )
    };
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

/// Sleep out whatever is left of a pass that did no work.
fn sleep_remainder(timeout: Duration, elapsed: Duration) {
    let remaining = timeout.saturating_sub(elapsed);
    if !remaining.is_zero() {
        std::thread::sleep(remaining);
    }
}

/// The thread that services a [`HostRunLoop`] when nothing else does.
///
/// Started when the editor opens and stopped when the editor that owns it is
/// dropped.
pub struct RunLoopService {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl RunLoopService {
    /// Start the service thread, or report why the editor cannot run.
    ///
    /// Fallible because there is no degraded mode: an editor whose descriptors
    /// and timers nobody services never draws and never answers a click, so a
    /// caller that swallowed a failed spawn would report an editor that is
    /// permanently dead.
    pub fn start(run_loop: Arc<HostRunLoop>) -> Result<Self, String> {
        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = Arc::clone(&stop);
        let thread = std::thread::Builder::new()
            .name("vst3-editor-run-loop".to_string())
            .spawn(move || {
                while !thread_stop.load(Ordering::Acquire) {
                    run_loop.service_once();
                }
            })
            .map_err(|error| format!("the editor's run-loop thread would not start: {error}"))?;

        Ok(Self {
            stop,
            thread: Some(thread),
        })
    }
}

impl Drop for RunLoopService {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            // Joined rather than detached: the thread calls into editor code
            // through retained handler pointers, and letting it outlive the
            // registration that holds them is a call into a released object.
            let _ = thread.join();
        }
    }
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
    }

    impl Drop for Pipe {
        fn drop(&mut self) {
            // SAFETY: both descriptors are open and owned by this value.
            unsafe {
                libc::close(self.read);
                libc::close(self.write);
            }
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
        assert_eq!(
            run_loop.service_file_descriptors(Duration::from_millis(0)),
            0
        );

        pipe.make_readable();
        assert_eq!(
            run_loop.service_file_descriptors(Duration::from_millis(50)),
            1
        );
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
            assert_eq!(
                run_loop.service_file_descriptors(Duration::from_millis(50)),
                1
            );
            assert_eq!(run_loop.unregister_event_handler(raw), kResultOk);
        }

        assert_eq!(
            run_loop.service_file_descriptors(Duration::from_millis(0)),
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
            run_loop.service_file_descriptors(Duration::from_millis(50)),
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

    /// A descriptor the kernel refuses is never readable and never will be, and
    /// `poll` returns on it instantly for ever. Keeping the registration turns
    /// every later pass into a spin that costs a full core for as long as the
    /// editor is open, so the registration goes and the pass still waits.
    #[test]
    fn a_descriptor_the_kernel_refuses_is_dropped_and_its_pass_still_waits() {
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

        let timeout = Duration::from_millis(20);
        let started = Instant::now();
        assert_eq!(run_loop.service_file_descriptors(timeout), 0);
        let waited = started.elapsed();

        assert!(
            waited >= timeout / 2,
            "a pass that neither waited nor dispatched is a busy spin, it took {waited:?}"
        );
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

    /// A pass that always waited its full slice would make the shortest timer a
    /// plugin can ask for unreachable: a 10 ms animation would run at the
    /// slice's rate instead, and the editor would visibly stutter.
    #[test]
    fn a_pass_never_waits_past_the_timer_it_owes_next() {
        let run_loop = HostRunLoop::new();
        let handler = ComWrapper::new(CountingTimerHandler::default());
        let raw = handler
            .as_com_ref::<ITimerHandler>()
            .expect("the fake handler implements ITimerHandler")
            .as_ptr();

        assert_eq!(
            run_loop.service_slice(Instant::now()),
            SERVICE_POLL_SLICE,
            "with no timer to owe, a pass waits its whole slice"
        );

        // SAFETY: `raw` borrows a live handler this test owns.
        assert_eq!(unsafe { run_loop.register_timer(raw, 10) }, kResultOk);

        let slice = run_loop.service_slice(Instant::now());
        assert!(
            slice <= Duration::from_millis(10),
            "a 10 ms timer must not wait out a longer slice, got {slice:?}"
        );
        assert!(slice >= MIN_TIMER_INTERVAL, "got {slice:?}");
    }

    /// An overdue timer asks for a zero-length wait, and a pass that took it
    /// would poll without blocking — the same spin an unusable descriptor
    /// causes. The floor is what keeps the loop a loop.
    #[test]
    fn an_overdue_timer_still_leaves_a_pass_something_to_wait_on() {
        let run_loop = HostRunLoop::new();
        let handler = ComWrapper::new(CountingTimerHandler::default());
        let raw = handler
            .as_com_ref::<ITimerHandler>()
            .expect("the fake handler implements ITimerHandler")
            .as_ptr();

        // SAFETY: `raw` borrows a live handler this test owns.
        assert_eq!(unsafe { run_loop.register_timer(raw, 10) }, kResultOk);

        assert_eq!(
            run_loop.service_slice(Instant::now() + Duration::from_secs(1)),
            MIN_TIMER_INTERVAL
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
