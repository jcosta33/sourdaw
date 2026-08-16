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

    fn stop(&mut self, registrar: &impl ServiceRegistrar) -> Result<(), String> {
        if let Some(fullname) = self.fullname.take() {
            registrar.unregister(&fullname)?;
        }

        Ok(())
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

        self.daemon
            .stop_browse(SERVICE_TYPE)
            .map_err(|e| format!("Failed to stop mDNS browsing: {}", e))?;

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
    /// nothing is listening for until the record's TTL expires.
    pub fn shutdown(mut self) -> Result<(), String> {
        self.stop_advertising()?;
        self.stop_browsing()?;
        self.daemon
            .shutdown()
            .map_err(|e| format!("Failed to shutdown mDNS: {}", e))?;
        Ok(())
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
    use std::cell::RefCell;

    use super::{Advertisement, ServiceInfo, ServiceRegistrar, SERVICE_TYPE};

    /// Records what the daemon would have been asked to do. No sockets, no
    /// daemon thread — the leak was in the bookkeeping, and this is the
    /// bookkeeping.
    #[derive(Default)]
    struct RecordingRegistrar {
        calls: RefCell<Vec<String>>,
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
}
