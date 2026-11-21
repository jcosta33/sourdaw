//! The timers and descriptors a CLAP plugin registers through
//! `clap.timer-support` and `clap.posix-fd-support`, and the dispatch that
//! services them.
//!
//! On X11 a CLAP editor has no event loop of its own: it hands the host the
//! descriptor of its display connection and the timers its animation needs, and
//! waits to be called back on the main thread. One [`ClapRunLoop`] belongs to
//! each instance (it lives in that instance's `HostCallbackState`), and joins
//! the shared pump in [`crate::editor_run_loop`] once the instance is built.
//! The shell runs that pump only on Linux and only while an editor is open, so
//! a registration made at any other time waits for the next editor to open
//! before anything fires.
//!
//! Every registration call and every callback is `[main-thread]`. The registry
//! lock is never held across a plugin call: a plugin may register or unregister
//! from inside its own `on_timer` or `on_fd`, and each dispatch first checks,
//! under the lock, that what it is about to deliver is still registered.
//!
//! Nothing here is reachable from the audio thread.

use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

use clap_sys::ext::posix_fd_support::{
    clap_plugin_posix_fd_support, clap_posix_fd_flags, CLAP_EXT_POSIX_FD_SUPPORT,
    CLAP_POSIX_FD_ERROR, CLAP_POSIX_FD_READ, CLAP_POSIX_FD_WRITE,
};
use clap_sys::ext::timer_support::{clap_plugin_timer_support, CLAP_EXT_TIMER_SUPPORT};
use clap_sys::id::{clap_id, CLAP_INVALID_ID};
use clap_sys::plugin::clap_plugin;

use crate::editor_run_loop::{poll_now, ServicedRunLoop};

/// The shortest period a timer is served at. A plugin asking for zero would
/// otherwise be due on every pass, and the pump's own turn rate is the real
/// ceiling anyway.
pub const MIN_TIMER_PERIOD: Duration = Duration::from_millis(1);

/// Names one descriptor registration, so a dispatch settled against a
/// descriptor number never lands on a later registration of the same number.
type RegistrationId = u64;

struct Timer {
    id: clap_id,
    period: Duration,
    due: Instant,
}

#[derive(Clone, Copy)]
struct Descriptor {
    fd: i32,
    flags: clap_posix_fd_flags,
    registration: RegistrationId,
}

#[derive(Default)]
struct Registry {
    next_timer_id: clap_id,
    next_registration: RegistrationId,
    timers: Vec<Timer>,
    descriptors: Vec<Descriptor>,
}

impl Registry {
    /// A timer id the host has not handed out to a live timer, never
    /// `CLAP_INVALID_ID`.
    fn mint_timer_id(&mut self) -> clap_id {
        loop {
            let candidate = self.next_timer_id;
            self.next_timer_id = self.next_timer_id.wrapping_add(1);
            let in_use = self.timers.iter().any(|timer| timer.id == candidate);
            if candidate != CLAP_INVALID_ID && !in_use {
                return candidate;
            }
        }
    }

    fn descriptor(&self, fd: i32) -> Option<&Descriptor> {
        self.descriptors
            .iter()
            .find(|descriptor| descriptor.fd == fd)
    }
}

/// The instance and the callbacks a dispatch calls, captured once the plugin's
/// `init` has succeeded.
struct AttachedPlugin {
    plugin: *const clap_plugin,
    timer: *const clap_plugin_timer_support,
    posix_fd: *const clap_plugin_posix_fd_support,
}

// SAFETY: the pointers are only dereferenced by a pass, which runs on the main
// thread the CLAP threading model binds these callbacks to. The wrapper that
// attached them gives up its pump registration before it destroys the instance,
// so no pass can reach them once they dangle.
unsafe impl Send for AttachedPlugin {}
// SAFETY: as above; a shared reference only ever reads the pointers.
unsafe impl Sync for AttachedPlugin {}

impl AttachedPlugin {
    /// # Safety
    /// The attached instance is live, and this is its main thread.
    unsafe fn on_timer(&self, id: clap_id) -> bool {
        if self.timer.is_null() {
            return false;
        }
        // SAFETY: non-null (checked above), and the plugin keeps its extension
        // struct alive for the instance's life (this fn's contract).
        let Some(on_timer) = (unsafe { (*self.timer).on_timer }) else {
            return false;
        };
        // SAFETY: the instance's own `on_timer`, matched as `Some`, called on the
        // main thread with an id the host minted for it.
        unsafe { on_timer(self.plugin, id) };
        true
    }

    /// # Safety
    /// The attached instance is live, and this is its main thread.
    unsafe fn on_fd(&self, fd: i32, flags: clap_posix_fd_flags) -> bool {
        if self.posix_fd.is_null() {
            return false;
        }
        // SAFETY: non-null (checked above), and the plugin keeps its extension
        // struct alive for the instance's life (this fn's contract).
        let Some(on_fd) = (unsafe { (*self.posix_fd).on_fd }) else {
            return false;
        };
        // SAFETY: the instance's own `on_fd`, matched as `Some`, called on the
        // main thread for a descriptor the plugin registered.
        unsafe { on_fd(self.plugin, fd, flags) };
        true
    }
}

/// One CLAP instance's timers and descriptors.
#[derive(Default)]
pub struct ClapRunLoop {
    registry: Mutex<Registry>,
    attached: OnceLock<AttachedPlugin>,
}

impl ClapRunLoop {
    /// Start a timer firing every `period_ms`, clamped to [`MIN_TIMER_PERIOD`].
    /// Returns the id the plugin's `on_timer` will be called with.
    pub fn register_timer(&self, period_ms: u32) -> clap_id {
        let period = Duration::from_millis(u64::from(period_ms)).max(MIN_TIMER_PERIOD);
        let mut registry = self.lock();
        let id = registry.mint_timer_id();
        registry.timers.push(Timer {
            id,
            period,
            due: Instant::now() + period,
        });
        id
    }

    /// Stop a timer. `false` when no timer has that id.
    pub fn unregister_timer(&self, id: clap_id) -> bool {
        let mut registry = self.lock();
        let before = registry.timers.len();
        registry.timers.retain(|timer| timer.id != id);
        registry.timers.len() != before
    }

    /// Watch `fd` for `flags`. `false` for a negative descriptor or one already
    /// registered, which CLAP leaves to `modify_fd`.
    pub fn register_fd(&self, fd: i32, flags: clap_posix_fd_flags) -> bool {
        if fd < 0 {
            return false;
        }
        let mut registry = self.lock();
        if registry.descriptor(fd).is_some() {
            return false;
        }
        let registration = registry.next_registration;
        registry.next_registration += 1;
        registry.descriptors.push(Descriptor {
            fd,
            flags,
            registration,
        });
        true
    }

    /// Change what `fd` is watched for. `false` when it is not registered.
    pub fn modify_fd(&self, fd: i32, flags: clap_posix_fd_flags) -> bool {
        let mut registry = self.lock();
        let Some(descriptor) = registry
            .descriptors
            .iter_mut()
            .find(|descriptor| descriptor.fd == fd)
        else {
            return false;
        };
        descriptor.flags = flags;
        true
    }

    /// Stop watching `fd`. `false` when it is not registered.
    pub fn unregister_fd(&self, fd: i32) -> bool {
        let mut registry = self.lock();
        let before = registry.descriptors.len();
        registry
            .descriptors
            .retain(|descriptor| descriptor.fd != fd);
        registry.descriptors.len() != before
    }

    /// Capture the instance and its `clap.timer-support` and
    /// `clap.posix-fd-support` callbacks, so a pass can deliver to them.
    /// Registrations made before this — during `init` — are kept, and fire
    /// from the first pass after it. A second attach changes nothing and
    /// answers `false`.
    ///
    /// # Safety
    /// `plugin` is a live instance whose `init` succeeded, called on its main
    /// thread, and it stays live until every pump registration of this run loop
    /// has been dropped.
    pub unsafe fn attach(&self, plugin: *const clap_plugin) -> bool {
        // SAFETY: a live, initialised instance on its main thread (this fn's
        // contract); the struct CLAP defines for the id.
        let timer = unsafe { query_extension(plugin, CLAP_EXT_TIMER_SUPPORT.as_ptr()) };
        // SAFETY: as above.
        let posix_fd = unsafe { query_extension(plugin, CLAP_EXT_POSIX_FD_SUPPORT.as_ptr()) };
        self.attached
            .set(AttachedPlugin {
                plugin,
                timer: timer.cast(),
                posix_fd: posix_fd.cast(),
            })
            .is_ok()
    }

    /// Fire every timer due at `now`. Returns how many `on_timer` calls ran.
    ///
    /// Nothing fires, and nothing comes due early, before the instance is
    /// attached. A due timer's next deadline is one period from `now`, so a
    /// pass that ran late does not then fire the same timer repeatedly to
    /// catch up.
    pub fn service_timers(&self, now: Instant) -> usize {
        let Some(attached) = self.attached.get() else {
            return 0;
        };
        let mut delivered = 0;
        for id in self.take_due_timers(now) {
            if !self.has_timer(id) {
                continue;
            }
            // SAFETY: attached instances stay live while a pass can reach them
            // (`attach`'s contract), and a pass is the main thread.
            if unsafe { attached.on_timer(id) } {
                delivered += 1;
            }
        }
        delivered
    }

    fn take_due_timers(&self, now: Instant) -> Vec<clap_id> {
        let mut registry = self.lock();
        registry
            .timers
            .iter_mut()
            .filter(|timer| timer.due <= now)
            .map(|timer| {
                timer.due = now + timer.period;
                timer.id
            })
            .collect()
    }

    fn has_timer(&self, id: clap_id) -> bool {
        self.lock().timers.iter().any(|timer| timer.id == id)
    }

    /// Hand every registered descriptor on which something it asked for has
    /// happened to `on_fd`. Returns how many `on_fd` calls ran.
    ///
    /// A descriptor the kernel refuses (`POLLNVAL`) is not open in this
    /// process: it has nothing to report, polls instantly for ever, and is
    /// dropped without a call.
    pub fn service_descriptors(&self) -> usize {
        let Some(attached) = self.attached.get() else {
            return 0;
        };
        let watched: Vec<Descriptor> = self.lock().descriptors.clone();
        let mut poll_fds: Vec<libc::pollfd> = watched
            .iter()
            .map(|descriptor| libc::pollfd {
                fd: descriptor.fd,
                events: requested_events(descriptor.flags),
                revents: 0,
            })
            .collect();
        if !poll_now(&mut poll_fds) {
            return 0;
        }

        let mut delivered = 0;
        for (descriptor, poll_fd) in watched.iter().zip(&poll_fds) {
            if !self.deliverable(descriptor, poll_fd.revents) || !self.still_registered(descriptor)
            {
                continue;
            }
            // SAFETY: attached instances stay live while a pass can reach them
            // (`attach`'s contract), and a pass is the main thread.
            if unsafe { attached.on_fd(descriptor.fd, happened_flags(poll_fd.revents)) } {
                delivered += 1;
            }
        }
        delivered
    }

    /// Whether `revents` is something to deliver. A refused descriptor is
    /// dropped here instead.
    fn deliverable(&self, descriptor: &Descriptor, revents: libc::c_short) -> bool {
        if revents & libc::POLLNVAL != 0 {
            self.lock()
                .descriptors
                .retain(|watched| watched.registration != descriptor.registration);
            return false;
        }
        happened_flags(revents) != 0
    }

    /// Whether the registration the poll answered for is still the one on this
    /// descriptor. One unregistered from inside an earlier callback this pass
    /// may already be closed, and its number reused.
    fn still_registered(&self, descriptor: &Descriptor) -> bool {
        self.lock()
            .descriptor(descriptor.fd)
            .is_some_and(|current| current.registration == descriptor.registration)
    }

    fn lock(&self) -> MutexGuard<'_, Registry> {
        self.registry
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    #[cfg(test)]
    pub(crate) fn timer_period(&self, id: clap_id) -> Option<Duration> {
        self.lock()
            .timers
            .iter()
            .find(|timer| timer.id == id)
            .map(|timer| timer.period)
    }

    #[cfg(test)]
    pub(crate) fn has_descriptor(&self, fd: i32) -> bool {
        self.lock().descriptor(fd).is_some()
    }
}

impl ServicedRunLoop for ClapRunLoop {
    fn service_once(&self) -> usize {
        self.service_timers(Instant::now()) + self.service_descriptors()
    }
}

/// # Safety
/// `plugin` is a live, initialised instance, on its main thread, and `id` is
/// NUL-terminated.
unsafe fn query_extension(
    plugin: *const clap_plugin,
    id: *const std::ffi::c_char,
) -> *const std::ffi::c_void {
    // SAFETY: a live instance (this fn's contract).
    let Some(get_extension) = (unsafe { (*plugin).get_extension }) else {
        return std::ptr::null();
    };
    // SAFETY: the instance's own `get_extension`, matched as `Some`, on its main
    // thread with a NUL-terminated id (this fn's contract).
    unsafe { get_extension(plugin, id) }
}

/// The `poll` events a CLAP flag set asks for. Errors are always reported.
fn requested_events(flags: clap_posix_fd_flags) -> libc::c_short {
    let mut events = 0;
    if flags & CLAP_POSIX_FD_READ != 0 {
        events |= libc::POLLIN;
    }
    if flags & CLAP_POSIX_FD_WRITE != 0 {
        events |= libc::POLLOUT;
    }
    events
}

/// The CLAP flags for what `poll` said happened. `POLLERR` and `POLLHUP` are
/// both the descriptor's error condition.
fn happened_flags(revents: libc::c_short) -> clap_posix_fd_flags {
    let mut flags = 0;
    if revents & libc::POLLIN != 0 {
        flags |= CLAP_POSIX_FD_READ;
    }
    if revents & libc::POLLOUT != 0 {
        flags |= CLAP_POSIX_FD_WRITE;
    }
    if revents & (libc::POLLERR | libc::POLLHUP) != 0 {
        flags |= CLAP_POSIX_FD_ERROR;
    }
    flags
}

#[cfg(test)]
mod tests;
