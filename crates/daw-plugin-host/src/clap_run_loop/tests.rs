//! Driven the way a plugin drives it: through the host extension structs a
//! `clap_host` hands out, with a Rust-built `clap_plugin` that records every
//! callback and the thread it arrived on.

use super::*;
use crate::clap_host::{
    create_host_descriptor, HostCallbackState, HOST_POSIX_FD_SUPPORT, HOST_TIMER_SUPPORT,
};
use crate::editor_run_loop::{register_editor_run_loop, service_editor_run_loops};
use clap_sys::host::clap_host;
use std::ffi::{c_char, c_void, CStr};
use std::sync::Arc;
use std::thread::ThreadId;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Call {
    Timer(clap_id, ThreadId),
    Fd(i32, clap_posix_fd_flags, ThreadId),
}

/// What the fake plugin does from inside its next `on_timer` or `on_fd`,
/// before returning.
type Reentry = Box<dyn FnOnce()>;

#[derive(Default)]
struct Recorder {
    calls: Mutex<Vec<Call>>,
    on_next_timer: Mutex<Option<Reentry>>,
    on_next_fd: Mutex<Option<Reentry>>,
}

impl Recorder {
    fn calls(&self) -> Vec<Call> {
        self.calls.lock().unwrap().clone()
    }

    fn timer_calls(&self, id: clap_id) -> usize {
        self.calls()
            .iter()
            .filter(|call| matches!(call, Call::Timer(fired, _) if *fired == id))
            .count()
    }

    fn fd_calls(&self) -> Vec<(i32, clap_posix_fd_flags)> {
        self.calls()
            .iter()
            .filter_map(|call| match call {
                Call::Fd(fd, flags, _) => Some((*fd, *flags)),
                Call::Timer(..) => None,
            })
            .collect()
    }
}

/// # Safety
/// `plugin` is a fake built by [`Instance`], whose recorder is still alive.
unsafe fn recorder<'a>(plugin: *const clap_plugin) -> &'a Recorder {
    // SAFETY: a fake whose `plugin_data` is its live recorder (this fn's contract).
    let data = unsafe { (*plugin).plugin_data };
    // SAFETY: as above.
    unsafe { &*data.cast::<Recorder>() }
}

unsafe extern "C" fn fake_on_timer(plugin: *const clap_plugin, timer_id: clap_id) {
    // SAFETY: the host calls this only on the fake it was attached to.
    let recorder = unsafe { recorder(plugin) };
    recorder
        .calls
        .lock()
        .unwrap()
        .push(Call::Timer(timer_id, std::thread::current().id()));
    let reentry = recorder.on_next_timer.lock().unwrap().take();
    if let Some(reentry) = reentry {
        reentry();
    }
}

unsafe extern "C" fn fake_on_fd(plugin: *const clap_plugin, fd: i32, flags: clap_posix_fd_flags) {
    // SAFETY: the host calls this only on the fake it was attached to.
    let recorder = unsafe { recorder(plugin) };
    recorder
        .calls
        .lock()
        .unwrap()
        .push(Call::Fd(fd, flags, std::thread::current().id()));
    let reentry = recorder.on_next_fd.lock().unwrap().take();
    if let Some(reentry) = reentry {
        reentry();
    }
}

static FAKE_TIMER: clap_plugin_timer_support = clap_plugin_timer_support {
    on_timer: Some(fake_on_timer),
};

static FAKE_POSIX_FD: clap_plugin_posix_fd_support = clap_plugin_posix_fd_support {
    on_fd: Some(fake_on_fd),
};

unsafe extern "C" fn fake_get_extension(
    _plugin: *const clap_plugin,
    id: *const c_char,
) -> *const c_void {
    // SAFETY: the host passes a NUL-terminated extension id.
    let id = unsafe { CStr::from_ptr(id) };
    if id == CLAP_EXT_TIMER_SUPPORT {
        return (&FAKE_TIMER as *const clap_plugin_timer_support).cast();
    }
    if id == CLAP_EXT_POSIX_FD_SUPPORT {
        return (&FAKE_POSIX_FD as *const clap_plugin_posix_fd_support).cast();
    }
    std::ptr::null()
}

/// One fake instance: its host state and descriptor, as a wrapper pins them,
/// and the plugin the host calls back into.
struct Instance {
    state: Box<HostCallbackState>,
    host: Box<clap_host>,
    recorder: Box<Recorder>,
    plugin: Box<clap_plugin>,
}

impl Instance {
    fn new() -> Self {
        let state = Box::new(HostCallbackState::default());
        let mut host = Box::new(create_host_descriptor());
        host.host_data = (&*state as *const HostCallbackState).cast_mut().cast();
        let recorder = Box::new(Recorder::default());
        let plugin = Box::new(clap_plugin {
            desc: std::ptr::null(),
            plugin_data: (&*recorder as *const Recorder).cast_mut().cast(),
            init: None,
            destroy: None,
            activate: None,
            deactivate: None,
            start_processing: None,
            stop_processing: None,
            reset: None,
            process: None,
            get_extension: Some(fake_get_extension),
            on_main_thread: None,
        });
        Self {
            state,
            host,
            recorder,
            plugin,
        }
    }

    fn run_loop(&self) -> &Arc<ClapRunLoop> {
        self.state.run_loop()
    }

    fn host(&self) -> *const clap_host {
        &*self.host
    }

    fn attach(&self) -> bool {
        // SAFETY: the fake outlives every pass this test makes.
        unsafe { self.run_loop().attach(&*self.plugin) }
    }

    fn register_timer(&self, period_ms: u32) -> Option<clap_id> {
        let mut id = CLAP_INVALID_ID;
        let register = HOST_TIMER_SUPPORT.register_timer.unwrap();
        // SAFETY: this instance's own live host, and a writable id.
        let registered = unsafe { register(self.host(), period_ms, &mut id) };
        registered.then_some(id)
    }

    fn unregister_timer(&self, id: clap_id) -> bool {
        let unregister = HOST_TIMER_SUPPORT.unregister_timer.unwrap();
        // SAFETY: this instance's own live host.
        unsafe { unregister(self.host(), id) }
    }

    fn register_fd(&self, fd: i32, flags: clap_posix_fd_flags) -> bool {
        let register = HOST_POSIX_FD_SUPPORT.register_fd.unwrap();
        // SAFETY: this instance's own live host.
        unsafe { register(self.host(), fd, flags) }
    }

    fn modify_fd(&self, fd: i32, flags: clap_posix_fd_flags) -> bool {
        let modify = HOST_POSIX_FD_SUPPORT.modify_fd.unwrap();
        // SAFETY: this instance's own live host.
        unsafe { modify(self.host(), fd, flags) }
    }

    fn unregister_fd(&self, fd: i32) -> bool {
        let unregister = HOST_POSIX_FD_SUPPORT.unregister_fd.unwrap();
        // SAFETY: this instance's own live host.
        unsafe { unregister(self.host(), fd) }
    }

    /// A pass far enough ahead that every registered timer is due.
    fn fire_every_timer(&self) -> usize {
        self.run_loop()
            .service_timers(Instant::now() + Duration::from_secs(60))
    }
}

/// A descriptor number nothing in this process has open, so `poll` answers
/// `POLLNVAL` for it.
const NEVER_OPEN_DESCRIPTOR: i32 = 1_000_000;

struct Pipe {
    read: i32,
    write: i32,
}

impl Pipe {
    fn open() -> Self {
        let mut ends: [libc::c_int; 2] = [0; 2];
        // SAFETY: `ends` is a live two-element array, as `pipe` requires.
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

#[test]
fn timer_ids_are_host_minted_distinct_and_never_the_invalid_id() {
    let instance = Instance::new();
    let first = instance.register_timer(10).unwrap();
    let second = instance.register_timer(10).unwrap();

    assert_ne!(first, CLAP_INVALID_ID);
    assert_ne!(second, CLAP_INVALID_ID);
    assert_ne!(first, second);
}

#[test]
fn minting_skips_the_invalid_id_and_ids_still_in_use() {
    let mut registry = Registry {
        next_timer_id: CLAP_INVALID_ID,
        ..Registry::default()
    };
    registry.timers.push(Timer {
        id: 0,
        period: MIN_TIMER_PERIOD,
        due: Instant::now(),
    });

    assert_eq!(registry.mint_timer_id(), 1);
}

#[test]
fn registering_a_timer_into_a_null_id_is_refused() {
    let instance = Instance::new();
    let register = HOST_TIMER_SUPPORT.register_timer.unwrap();

    // SAFETY: this instance's own live host; the null out-pointer is the input
    // under test.
    let registered = unsafe { register(instance.host(), 10, std::ptr::null_mut()) };

    assert!(!registered);
    instance.attach();
    assert_eq!(instance.fire_every_timer(), 0, "nothing was registered");
}

#[test]
fn a_host_without_instance_state_refuses_every_registration() {
    let host = create_host_descriptor();
    let mut id = CLAP_INVALID_ID;
    let register_timer = HOST_TIMER_SUPPORT.register_timer.unwrap();
    let register_fd = HOST_POSIX_FD_SUPPORT.register_fd.unwrap();

    // SAFETY: a live host whose `host_data` is null, which is the input under test.
    assert!(!unsafe { register_timer(&host, 10, &mut id) });
    // SAFETY: as above.
    assert!(!unsafe { register_fd(&host, 0, CLAP_POSIX_FD_READ) });
}

#[test]
fn a_period_below_the_floor_is_served_at_the_floor() {
    let instance = Instance::new();
    let zero = instance.register_timer(0).unwrap();
    let slow = instance.register_timer(250).unwrap();

    assert_eq!(
        instance.run_loop().timer_period(zero),
        Some(MIN_TIMER_PERIOD)
    );
    assert_eq!(
        instance.run_loop().timer_period(slow),
        Some(Duration::from_millis(250))
    );
}

#[test]
fn a_due_timer_fires_with_its_id_on_the_servicing_thread() {
    let instance = Instance::new();
    instance.attach();
    let id = instance.register_timer(10).unwrap();

    assert_eq!(
        instance.run_loop().service_timers(Instant::now()),
        0,
        "a timer is not due on registration"
    );
    assert_eq!(instance.fire_every_timer(), 1);
    assert_eq!(
        instance.recorder.calls(),
        vec![Call::Timer(id, std::thread::current().id())]
    );
}

#[test]
fn an_unregistered_timer_stops_firing_and_an_unknown_id_is_refused() {
    let instance = Instance::new();
    instance.attach();
    let id = instance.register_timer(10).unwrap();
    instance.fire_every_timer();

    assert!(instance.unregister_timer(id));
    assert!(!instance.unregister_timer(id), "already gone");
    assert_eq!(instance.fire_every_timer(), 0);
    assert_eq!(instance.recorder.timer_calls(id), 1);
}

#[test]
fn a_timer_registered_before_attach_waits_and_then_fires() {
    let instance = Instance::new();
    let id = instance.register_timer(10).unwrap();

    assert_eq!(instance.fire_every_timer(), 0, "nothing to deliver to yet");
    assert!(instance.attach());
    assert_eq!(instance.fire_every_timer(), 1);
    assert_eq!(instance.recorder.timer_calls(id), 1);
}

#[test]
fn a_second_attach_is_refused() {
    let instance = Instance::new();
    assert!(instance.attach());
    assert!(!instance.attach());
}

/// A plugin may unregister a timer from inside another's `on_timer`. The pass
/// must not then deliver to the one it took back — and must not be holding
/// the registry while the plugin runs, or the unregister would deadlock.
#[test]
fn a_timer_unregistered_from_inside_a_callback_is_not_fired_by_the_same_pass() {
    let instance = Instance::new();
    instance.attach();
    let first = instance.register_timer(10).unwrap();
    let second = instance.register_timer(10).unwrap();
    let host = instance.host() as usize;
    *instance.recorder.on_next_timer.lock().unwrap() = Some(Box::new(move || {
        let unregister = HOST_TIMER_SUPPORT.unregister_timer.unwrap();
        // SAFETY: the instance's live host, called back on its pump thread.
        assert!(unsafe { unregister(host as *const clap_host, second) });
    }));

    assert_eq!(instance.fire_every_timer(), 1);
    assert_eq!(instance.recorder.timer_calls(first), 1);
    assert_eq!(instance.recorder.timer_calls(second), 0);
}

#[test]
fn descriptor_registration_refuses_negative_duplicate_and_absent_descriptors() {
    let instance = Instance::new();
    let pipe = Pipe::open();

    assert!(!instance.register_fd(-1, CLAP_POSIX_FD_READ));
    assert!(instance.register_fd(pipe.read, CLAP_POSIX_FD_READ));
    assert!(!instance.register_fd(pipe.read, CLAP_POSIX_FD_READ));
    assert!(!instance.modify_fd(pipe.write, CLAP_POSIX_FD_READ));
    assert!(!instance.unregister_fd(pipe.write));
    assert!(instance.modify_fd(pipe.read, CLAP_POSIX_FD_WRITE));
    assert!(instance.unregister_fd(pipe.read));
    assert!(!instance.unregister_fd(pipe.read));
}

#[test]
fn a_readable_descriptor_is_delivered_as_read_on_the_servicing_thread() {
    let instance = Instance::new();
    instance.attach();
    let pipe = Pipe::open();
    assert!(instance.register_fd(pipe.read, CLAP_POSIX_FD_READ));

    assert_eq!(
        instance.run_loop().service_descriptors(),
        0,
        "nothing to read yet"
    );
    pipe.make_readable();
    assert_eq!(instance.run_loop().service_descriptors(), 1);
    assert_eq!(
        instance.recorder.calls(),
        vec![Call::Fd(
            pipe.read,
            CLAP_POSIX_FD_READ,
            std::thread::current().id()
        )]
    );
}

/// The poll asks for what the plugin registered, so a write registration is
/// told the descriptor is writable — and stops being told once modified away.
#[test]
fn a_write_registration_is_polled_for_writability_and_modify_changes_it() {
    let instance = Instance::new();
    instance.attach();
    let pipe = Pipe::open();
    assert!(instance.register_fd(pipe.write, CLAP_POSIX_FD_WRITE));

    assert_eq!(instance.run_loop().service_descriptors(), 1);
    assert_eq!(
        instance.recorder.fd_calls(),
        vec![(pipe.write, CLAP_POSIX_FD_WRITE)]
    );

    assert!(instance.modify_fd(pipe.write, CLAP_POSIX_FD_READ));
    assert_eq!(
        instance.run_loop().service_descriptors(),
        0,
        "a write end is never readable"
    );
}

#[test]
fn a_hung_up_descriptor_is_delivered_as_an_error() {
    let instance = Instance::new();
    instance.attach();
    let mut pipe = Pipe::open();
    assert!(instance.register_fd(pipe.read, CLAP_POSIX_FD_READ));

    pipe.hang_up();
    assert_eq!(instance.run_loop().service_descriptors(), 1);
    let delivered = instance.recorder.fd_calls();
    assert_eq!(delivered.len(), 1);
    assert_eq!(delivered[0].0, pipe.read);
    assert_ne!(delivered[0].1 & CLAP_POSIX_FD_ERROR, 0);
}

#[test]
fn a_descriptor_the_kernel_refuses_is_dropped_without_a_call() {
    let instance = Instance::new();
    instance.attach();
    assert!(instance.register_fd(NEVER_OPEN_DESCRIPTOR, CLAP_POSIX_FD_READ));

    assert_eq!(instance.run_loop().service_descriptors(), 0);
    assert!(!instance.run_loop().has_descriptor(NEVER_OPEN_DESCRIPTOR));
    assert!(instance.recorder.calls().is_empty());
}

#[test]
fn an_unregistered_descriptor_is_not_delivered() {
    let instance = Instance::new();
    instance.attach();
    let pipe = Pipe::open();
    assert!(instance.register_fd(pipe.read, CLAP_POSIX_FD_READ));
    pipe.make_readable();

    assert!(instance.unregister_fd(pipe.read));
    assert_eq!(instance.run_loop().service_descriptors(), 0);
    assert!(instance.recorder.calls().is_empty());
}

/// Two readable descriptors, polled together; the first one's callback does
/// `reentry` with the second's number before the pass reaches it.
fn deliveries_after_the_first_callback_does(
    reentry: impl FnOnce(usize, i32) + 'static,
) -> Vec<(i32, clap_posix_fd_flags)> {
    let instance = Instance::new();
    instance.attach();
    let first = Pipe::open();
    let second = Pipe::open();
    assert!(instance.register_fd(first.read, CLAP_POSIX_FD_READ));
    assert!(instance.register_fd(second.read, CLAP_POSIX_FD_READ));
    first.make_readable();
    second.make_readable();
    let host = instance.host() as usize;
    let second_fd = second.read;
    *instance.recorder.on_next_fd.lock().unwrap() = Some(Box::new(move || reentry(host, second_fd)));

    instance.run_loop().service_descriptors();
    instance.recorder.fd_calls()
}

/// The poll answered for both before either was called, so the second's
/// readiness is stale once the first's callback has unregistered it.
#[test]
fn a_descriptor_unregistered_from_inside_a_callback_is_not_delivered_by_the_same_pass() {
    let delivered = deliveries_after_the_first_callback_does(|host, fd| {
        let unregister = HOST_POSIX_FD_SUPPORT.unregister_fd.unwrap();
        // SAFETY: the instance's live host, called back on its pump thread.
        assert!(unsafe { unregister(host as *const clap_host, fd) });
    });

    assert_eq!(delivered.len(), 1, "only the first descriptor is delivered");
}

/// A descriptor number unregistered and registered again inside the pass is a
/// new registration, which the poll that ran before it said nothing about.
#[test]
fn a_descriptor_re_registered_from_inside_a_callback_is_not_handed_the_stale_poll() {
    let delivered = deliveries_after_the_first_callback_does(|host, fd| {
        let unregister = HOST_POSIX_FD_SUPPORT.unregister_fd.unwrap();
        let register = HOST_POSIX_FD_SUPPORT.register_fd.unwrap();
        // SAFETY: the instance's live host, called back on its pump thread.
        assert!(unsafe { unregister(host as *const clap_host, fd) });
        // SAFETY: as above.
        assert!(unsafe { register(host as *const clap_host, fd, CLAP_POSIX_FD_WRITE) });
    });

    assert_eq!(delivered.len(), 1, "only the first descriptor is delivered");
}

/// The run loop is what the shared pump drives: a registered instance's timer
/// fires from `service_editor_run_loops`, and stops once the registration
/// drops.
#[test]
fn the_shared_pump_services_a_registered_instance_until_it_leaves() {
    let instance = Instance::new();
    instance.attach();
    let id = instance.register_timer(0).unwrap();

    let registration = register_editor_run_loop(Arc::clone(instance.run_loop()));
    std::thread::sleep(MIN_TIMER_PERIOD * 4);
    service_editor_run_loops();
    let fired = instance.recorder.timer_calls(id);
    assert!(fired > 0, "the pump must fire a due timer");

    drop(registration);
    std::thread::sleep(MIN_TIMER_PERIOD * 4);
    service_editor_run_loops();
    assert_eq!(instance.recorder.timer_calls(id), fired);
}

#[test]
fn both_extensions_are_offered_on_linux_alone() {
    let host = create_host_descriptor();
    let get_extension = host.get_extension.unwrap();
    // SAFETY: a live host and a static NUL-terminated id.
    let timer = unsafe { get_extension(&host, CLAP_EXT_TIMER_SUPPORT.as_ptr()) };
    // SAFETY: as above.
    let posix_fd = unsafe { get_extension(&host, CLAP_EXT_POSIX_FD_SUPPORT.as_ptr()) };

    let offered = cfg!(target_os = "linux");
    assert_eq!(!timer.is_null(), offered);
    assert_eq!(!posix_fd.is_null(), offered);
}
