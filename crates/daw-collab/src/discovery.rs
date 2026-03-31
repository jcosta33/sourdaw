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

/// Manages mDNS service advertisement and discovery for LAN collaboration.
pub struct LanDiscovery {
    daemon: ServiceDaemon,
    advertised_fullname: Option<String>,
    discovered: Arc<Mutex<HashMap<String, NearbySession>>>,
}

impl LanDiscovery {
    pub fn new() -> Result<Self, String> {
        let daemon = ServiceDaemon::new().map_err(|e| format!("Failed to start mDNS: {}", e))?;
        Ok(Self {
            daemon,
            advertised_fullname: None,
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
            &format!("{}.local.", hostname::get().unwrap_or_default().to_string_lossy()),
            "",
            port,
            properties,
        )
        .map_err(|e| format!("Failed to create service info: {}", e))?;

        let fullname = service.get_fullname().to_string();
        self.daemon
            .register(service)
            .map_err(|e| format!("Failed to register mDNS service: {}", e))?;

        self.advertised_fullname = Some(fullname);
        Ok(())
    }

    /// Stop advertising the current session.
    pub fn stop_advertising(&mut self) -> Result<(), String> {
        if let Some(fullname) = self.advertised_fullname.take() {
            self.daemon
                .unregister(&fullname)
                .map_err(|e| format!("Failed to unregister mDNS service: {}", e))?;
        }
        Ok(())
    }

    /// Start browsing for nearby sessions. Discovered sessions are stored internally.
    pub fn start_browsing(&self) -> Result<(), String> {
        let receiver = self
            .daemon
            .browse(SERVICE_TYPE)
            .map_err(|e| format!("Failed to browse mDNS: {}", e))?;

        let discovered = self.discovered.clone();

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
                            addresses: info
                                .get_addresses()
                                .iter()
                                .map(|a| a.to_string())
                                .collect(),
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
                    _ => {}
                }
            }
        });

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
    pub fn shutdown(self) -> Result<(), String> {
        self.daemon
            .shutdown()
            .map_err(|e| format!("Failed to shutdown mDNS: {}", e))?;
        Ok(())
    }
}
