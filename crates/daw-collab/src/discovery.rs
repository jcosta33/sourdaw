use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use serde::{Deserialize, Serialize};

const SERVICE_TYPE: &str = "_sourdaw._tcp.local.";
const PROPERTY_SESSION_ID: &str = "session_id";
const PROPERTY_HOST_NAME: &str = "host_name";
const PROPERTY_PROJECT_NAME: &str = "project_name";
const PROPERTY_APPROVAL_REQUIRED: &str = "approval_required";

/// A discovered nearby session advertised via mDNS.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NearbySession {
    pub instance_name: String,
    pub host_name: String,
    pub session_id: String,
    pub project_name: String,
    pub approval_required: bool,
    pub addresses: Vec<String>,
    pub port: u16,
}

/// The registration half of the mDNS daemon.
///
/// Isolated behind a trait so the advertise/retire bookkeeping — the part that
/// leaked registrations — can be exercised without binding real sockets.
trait ServiceRegistrar {
    fn register(&self, service: ServiceInfo) -> Result<(), String>;
    fn unregister(&self, fullname: &str) -> Result<(), String>;
}

/// Every daemon-side operation the teardown sequence drives.
///
/// The retirement order — retire the advertisement, stop browsing, then bring
/// the daemon down — is the part that peers observe, and it is only reachable
/// through this trait, so a test can pin it without binding real sockets.
trait DiscoveryDaemon: ServiceRegistrar {
    fn stop_browsing(&self) -> Result<(), String>;
    fn shutdown(&self) -> Result<(), String>;
}

impl ServiceRegistrar for ServiceDaemon {
    fn register(&self, service: ServiceInfo) -> Result<(), String> {
        ServiceDaemon::register(self, service)
            .map(|_| ())
            .map_err(|e| format!("Failed to register mDNS service: {}", e))
    }

    fn unregister(&self, fullname: &str) -> Result<(), String> {
        ServiceDaemon::unregister(self, fullname)
            .map(|_| ())
            .map_err(|e| format!("Failed to unregister mDNS service: {}", e))
    }
}

impl DiscoveryDaemon for ServiceDaemon {
    fn stop_browsing(&self) -> Result<(), String> {
        ServiceDaemon::stop_browse(self, SERVICE_TYPE)
            .map(|_| ())
            .map_err(|e| format!("Failed to stop mDNS browsing: {}", e))
    }

    fn shutdown(&self) -> Result<(), String> {
        ServiceDaemon::shutdown(self)
            .map(|_| ())
            .map_err(|e| format!("Failed to shutdown mDNS: {}", e))
    }
}

/// Retire everything the daemon holds, in the order peers observe.
///
/// Every step runs unconditionally and the first failure is the one reported:
/// `mdns-sd`'s daemon has no `Drop` and only exits on its `Exit` command, so a
/// failed unregister that skipped `shutdown` would strand the daemon thread and
/// its sockets for the rest of the process lifetime.
fn retire(
    daemon: &impl DiscoveryDaemon,
    advertisement: &mut Advertisement,
    browsing: bool,
) -> Result<(), String> {
    let advertising = advertisement.stop(daemon);
    let browsing = if browsing {
        daemon.stop_browsing()
    } else {
        Ok(())
    };
    let daemon = daemon.shutdown();

    advertising.and(browsing).and(daemon)
}

/// The single live mDNS registration.
///
/// A registration is keyed by its fullname, and the fullname is derived from
/// the project name — so re-advertising under a different project registers a
/// *second* service while only the latest can ever be retired. The orphan stays
/// live until its TTL expires, advertising a stale session id and port that
/// peers can see and try to join. Registering therefore retires the previous
/// registration first, unconditionally.
#[derive(Default)]
struct Advertisement {
    fullname: Option<String>,
}

impl Advertisement {
    fn register(
        &mut self,
        registrar: &impl ServiceRegistrar,
        service: ServiceInfo,
    ) -> Result<(), String> {
        self.stop(registrar)?;

        let fullname = service.get_fullname().to_string();
        registrar.register(service)?;
        self.fullname = Some(fullname);

        Ok(())
    }

    /// Retire the live registration, keeping the handle when the daemon refuses.
    ///
    /// Dropping the fullname before the unregister returned left a service
    /// registered on the network with nothing left that could name it: the
    /// struct believed it was advertising nothing, so neither a later stop nor
    /// a re-advertise could ever retire it.
    fn stop(&mut self, registrar: &impl ServiceRegistrar) -> Result<(), String> {
        let Some(fullname) = self.fullname.take() else {
            return Ok(());
        };

        if let Err(error) = registrar.unregister(&fullname) {
            self.fullname = Some(fullname);
            return Err(error);
        }

        Ok(())
    }

    /// Abandon the handle without contacting the daemon.
    ///
    /// Only for the path where the daemon is already down and no further
    /// unregister can reach the network.
    fn forget(&mut self) {
        self.fullname = None;
    }
}

/// Manages mDNS service advertisement and discovery for LAN collaboration.
pub struct LanDiscovery {
    daemon: ServiceDaemon,
    advertisement: Advertisement,
    browsing: bool,
    discovered: Arc<Mutex<HashMap<String, NearbySession>>>,
}

impl LanDiscovery {
    pub fn new() -> Result<Self, String> {
        let daemon = ServiceDaemon::new().map_err(|e| format!("Failed to start mDNS: {}", e))?;
        Ok(Self {
            daemon,
            advertisement: Advertisement::default(),
            browsing: false,
            discovered: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    /// Advertise a collaboration session on the local network.
    pub fn advertise(
        &mut self,
        session_id: &str,
        host_name: &str,
        project_name: &str,
        port: u16,
        approval_required: bool,
    ) -> Result<(), String> {
        let instance_name = format!("{} — {}", host_name, project_name);

        let mut properties = HashMap::new();
        properties.insert(PROPERTY_SESSION_ID.to_string(), session_id.to_string());
        properties.insert(PROPERTY_HOST_NAME.to_string(), host_name.to_string());
        properties.insert(PROPERTY_PROJECT_NAME.to_string(), project_name.to_string());
        properties.insert(
            PROPERTY_APPROVAL_REQUIRED.to_string(),
            approval_required.to_string(),
        );

        let service = ServiceInfo::new(
            SERVICE_TYPE,
            &instance_name,
            &format!(
                "{}.local.",
                hostname::get().unwrap_or_default().to_string_lossy()
            ),
            "",
            port,
            properties,
        )
        .map_err(|e| format!("Failed to create service info: {}", e))?;

        self.advertisement.register(&self.daemon, service)
    }

    /// Stop advertising the current session.
    pub fn stop_advertising(&mut self) -> Result<(), String> {
        self.advertisement.stop(&self.daemon)
    }

    /// Start browsing for nearby sessions. Discovered sessions are stored internally.
    pub fn start_browsing(&mut self) -> Result<(), String> {
        if self.browsing {
            return Ok(());
        }

        let receiver = self
            .daemon
            .browse(SERVICE_TYPE)
            .map_err(|e| format!("Failed to browse mDNS: {}", e))?;

        let discovered = self.discovered.clone();

        self.browsing = true;

        std::thread::spawn(move || {
            while let Ok(event) = receiver.recv() {
                match event {
                    ServiceEvent::ServiceResolved(info) => {
                        let session = NearbySession {
                            instance_name: info.get_fullname().to_string(),
                            host_name: info
                                .get_property_val_str(PROPERTY_HOST_NAME)
                                .unwrap_or("Unknown")
                                .to_string(),
                            session_id: info
                                .get_property_val_str(PROPERTY_SESSION_ID)
                                .unwrap_or("")
                                .to_string(),
                            project_name: info
                                .get_property_val_str(PROPERTY_PROJECT_NAME)
                                .unwrap_or("Untitled")
                                .to_string(),
                            approval_required: info
                                .get_property_val_str(PROPERTY_APPROVAL_REQUIRED)
                                .unwrap_or("false")
                                == "true",
                            addresses: info.get_addresses().iter().map(|a| a.to_string()).collect(),
                            port: info.get_port(),
                        };
                        if let Ok(mut map) = discovered.lock() {
                            map.insert(session.instance_name.clone(), session);
                        }
                    }
                    ServiceEvent::ServiceRemoved(_, fullname) => {
                        if let Ok(mut map) = discovered.lock() {
                            map.remove(&fullname);
                        }
                    }
                    ServiceEvent::SearchStopped(_) => {
                        break;
                    }
                    _ => {}
                }
            }
        });

        Ok(())
    }

    /// Stop browsing for nearby sessions and clear stale discovery results.
    pub fn stop_browsing(&mut self) -> Result<(), String> {
        if !self.browsing {
            return Ok(());
        }

        DiscoveryDaemon::stop_browsing(&self.daemon)?;

        self.browsing = false;
        if let Ok(mut map) = self.discovered.lock() {
            map.clear();
        }

        Ok(())
    }

    /// Get all currently discovered nearby sessions.
    pub fn get_nearby_sessions(&self) -> Vec<NearbySession> {
        self.discovered
            .lock()
            .map(|map| map.values().cloned().collect())
            .unwrap_or_default()
    }

    /// Shut down the mDNS daemon.
    ///
    /// Retires the advertisement before the daemon goes away: dropping the
    /// daemon without unregistering leaves peers seeing a joinable session that
    /// nothing is listening for until the record's TTL expires. A step that
    /// fails does not cancel the ones after it — see [`retire`].
    pub fn shutdown(mut self) -> Result<(), String> {
        let outcome = retire(&self.daemon, &mut self.advertisement, self.browsing);

        // The daemon is gone either way, so the `Drop` backstop must not chase
        // it with an unregister or a browse stop it can no longer deliver.
        self.advertisement.forget();
        self.browsing = false;
        if let Ok(mut map) = self.discovered.lock() {
            map.clear();
        }

        outcome
    }
}

impl Drop for LanDiscovery {
    /// Last-resort retirement for the paths that never reach `shutdown`.
    ///
    /// Best effort and panic-free by construction: a `Drop` that unwinds while
    /// another unwind is in flight aborts the process, and by this point there
    /// is no caller left to hand an error to. `shutdown` clears both pieces of
    /// state, so this is a no-op after an orderly quit.
    fn drop(&mut self) {
        let _ = self.stop_advertising();
        let _ = self.stop_browsing();
    }
}

#[cfg(test)]
mod tests {
    use std::cell::{Cell, RefCell};

    use super::{
        retire, Advertisement, DiscoveryDaemon, ServiceInfo, ServiceRegistrar, SERVICE_TYPE,
    };

    const UNREGISTER_REFUSED: &str = "Failed to unregister mDNS service: daemon refused";
    const STOP_BROWSING_REFUSED: &str = "Failed to stop mDNS browsing: daemon refused";

    /// Records what the daemon would have been asked to do. No sockets, no
    /// daemon thread — the leak was in the bookkeeping, and this is the
    /// bookkeeping.
    ///
    /// The failure budgets make the daemon refuse the first N calls of an
    /// operation, which is the shape that stranded state in production: a
    /// transient refusal, not a permanent one.
    #[derive(Default)]
    struct RecordingRegistrar {
        calls: RefCell<Vec<String>>,
        unregister_refusals: Cell<usize>,
        stop_browsing_refusals: Cell<usize>,
    }

    impl RecordingRegistrar {
        fn refusing(unregister_refusals: usize, stop_browsing_refusals: usize) -> Self {
            Self {
                calls: RefCell::new(Vec::new()),
                unregister_refusals: Cell::new(unregister_refusals),
                stop_browsing_refusals: Cell::new(stop_browsing_refusals),
            }
        }

        fn refuse(budget: &Cell<usize>) -> bool {
            let remaining = budget.get();
            if remaining == 0 {
                return false;
            }
            budget.set(remaining - 1);
            true
        }
    }

    impl ServiceRegistrar for RecordingRegistrar {
        fn register(&self, service: ServiceInfo) -> Result<(), String> {
            self.calls
                .borrow_mut()
                .push(format!("register {}", service.get_fullname()));
            Ok(())
        }

        fn unregister(&self, fullname: &str) -> Result<(), String> {
            self.calls
                .borrow_mut()
                .push(format!("unregister {}", fullname));
            if Self::refuse(&self.unregister_refusals) {
                return Err(UNREGISTER_REFUSED.to_string());
            }
            Ok(())
        }
    }

    impl DiscoveryDaemon for RecordingRegistrar {
        fn stop_browsing(&self) -> Result<(), String> {
            self.calls.borrow_mut().push("stop browsing".to_string());
            if Self::refuse(&self.stop_browsing_refusals) {
                return Err(STOP_BROWSING_REFUSED.to_string());
            }
            Ok(())
        }

        fn shutdown(&self) -> Result<(), String> {
            self.calls.borrow_mut().push("shutdown daemon".to_string());
            Ok(())
        }
    }

    fn service(instance_name: &str) -> ServiceInfo {
        ServiceInfo::new(
            SERVICE_TYPE,
            instance_name,
            "test-host.local.",
            "",
            7000,
            None,
        )
        .expect("the test service description is well formed")
    }

    /// The instance name embeds the project name, so a second `advertise` under
    /// a different project used to register a second service and overwrite the
    /// only handle that could retire the first. `stop_advertising` could then
    /// only ever retire the latest, leaving a ghost session advertising a stale
    /// session id and port to every peer on the network.
    #[test]
    fn re_advertising_retires_the_previous_registration() {
        let registrar = RecordingRegistrar::default();
        let mut advertisement = Advertisement::default();

        let first = service("Host — First Project");
        let second = service("Host — Second Project");
        let first_fullname = first.get_fullname().to_string();
        let second_fullname = second.get_fullname().to_string();

        advertisement
            .register(&registrar, first)
            .expect("the first advertisement registers");
        advertisement
            .register(&registrar, second)
            .expect("the second advertisement registers");
        advertisement
            .stop(&registrar)
            .expect("stopping retires the live registration");

        assert_eq!(
            registrar.calls.into_inner(),
            vec![
                format!("register {first_fullname}"),
                format!("unregister {first_fullname}"),
                format!("register {second_fullname}"),
                format!("unregister {second_fullname}"),
            ],
            "every registration must be retired exactly once"
        );
    }

    #[test]
    fn stopping_twice_does_not_unregister_twice() {
        let registrar = RecordingRegistrar::default();
        let mut advertisement = Advertisement::default();

        let only = service("Host — Only Project");
        let fullname = only.get_fullname().to_string();

        advertisement
            .register(&registrar, only)
            .expect("the advertisement registers");
        advertisement
            .stop(&registrar)
            .expect("first stop retires it");
        advertisement
            .stop(&registrar)
            .expect("second stop is inert");

        assert_eq!(
            registrar.calls.into_inner(),
            vec![
                format!("register {fullname}"),
                format!("unregister {fullname}"),
            ]
        );
    }

    #[test]
    fn stopping_without_advertising_never_touches_the_daemon() {
        let registrar = RecordingRegistrar::default();
        let mut advertisement = Advertisement::default();

        advertisement
            .stop(&registrar)
            .expect("stopping an idle advertisement succeeds");

        assert!(registrar.calls.into_inner().is_empty());
    }

    /// Dropping the handle before the unregister returned meant a refusal left
    /// the service registered on the network with nothing able to name it
    /// again: the struct believed it was advertising nothing.
    #[test]
    fn a_refused_unregister_leaves_the_registration_retirable() {
        let registrar = RecordingRegistrar::refusing(1, 0);
        let mut advertisement = Advertisement::default();

        let only = service("Host — Only Project");
        let fullname = only.get_fullname().to_string();

        advertisement
            .register(&registrar, only)
            .expect("the advertisement registers");
        assert_eq!(
            advertisement
                .stop(&registrar)
                .expect_err("the daemon refuses the first unregister"),
            UNREGISTER_REFUSED
        );
        advertisement
            .stop(&registrar)
            .expect("a later stop retires the still-live registration");

        assert_eq!(
            registrar.calls.into_inner(),
            vec![
                format!("register {fullname}"),
                format!("unregister {fullname}"),
                format!("unregister {fullname}"),
            ],
            "a refused unregister must not consume the only handle that can retire the service"
        );
    }

    #[test]
    fn re_advertising_after_a_refused_unregister_still_retires_the_old_registration() {
        let registrar = RecordingRegistrar::refusing(1, 0);
        let mut advertisement = Advertisement::default();

        let first = service("Host — First Project");
        let second = service("Host — Second Project");
        let first_fullname = first.get_fullname().to_string();
        let second_fullname = second.get_fullname().to_string();

        advertisement
            .register(&registrar, first)
            .expect("the first advertisement registers");
        advertisement
            .stop(&registrar)
            .expect_err("the daemon refuses the first unregister");
        advertisement
            .register(&registrar, second)
            .expect("re-advertising retires the stale registration first");

        assert_eq!(
            registrar.calls.into_inner(),
            vec![
                format!("register {first_fullname}"),
                format!("unregister {first_fullname}"),
                format!("unregister {first_fullname}"),
                format!("register {second_fullname}"),
            ]
        );
    }

    /// Peers keep seeing a joinable session until the advertisement is retired,
    /// so retirement has to reach the network before the daemon that carries it
    /// goes away.
    #[test]
    fn retirement_unregisters_before_the_daemon_goes_down() {
        let daemon = RecordingRegistrar::default();
        let mut advertisement = Advertisement::default();

        let only = service("Host — Only Project");
        let fullname = only.get_fullname().to_string();
        advertisement
            .register(&daemon, only)
            .expect("the advertisement registers");

        retire(&daemon, &mut advertisement, true).expect("an orderly retirement succeeds");

        assert_eq!(
            daemon.calls.into_inner(),
            vec![
                format!("register {fullname}"),
                format!("unregister {fullname}"),
                "stop browsing".to_string(),
                "shutdown daemon".to_string(),
            ]
        );
    }

    /// `mdns-sd`'s daemon has no `Drop` and only exits on its `Exit` command, so
    /// a refusal that short-circuited the sequence stranded the daemon thread
    /// and its sockets for the rest of the process lifetime.
    #[test]
    fn a_refused_step_neither_cancels_the_rest_nor_hides_the_first_failure() {
        let daemon = RecordingRegistrar::refusing(1, 1);
        let mut advertisement = Advertisement::default();

        let only = service("Host — Only Project");
        let fullname = only.get_fullname().to_string();
        advertisement
            .register(&daemon, only)
            .expect("the advertisement registers");

        let error = retire(&daemon, &mut advertisement, true)
            .expect_err("a refused step must still be reported");

        assert_eq!(error, UNREGISTER_REFUSED);
        assert_eq!(
            daemon.calls.into_inner(),
            vec![
                format!("register {fullname}"),
                format!("unregister {fullname}"),
                "stop browsing".to_string(),
                "shutdown daemon".to_string(),
            ],
            "every teardown step runs even after an earlier one is refused"
        );
    }

    #[test]
    fn retirement_leaves_a_daemon_that_was_never_browsing_alone() {
        let daemon = RecordingRegistrar::default();
        let mut advertisement = Advertisement::default();

        retire(&daemon, &mut advertisement, false).expect("an idle retirement succeeds");

        assert_eq!(
            daemon.calls.into_inner(),
            vec!["shutdown daemon".to_string()]
        );
    }
}
