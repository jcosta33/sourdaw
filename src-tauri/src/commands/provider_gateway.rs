use futures_util::StreamExt;
use serde::Serialize;
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::ipc::Channel;
use tokio::sync::{watch, Mutex};

const COMPILED_ADAPTER_ID: &str = "builtin.openai-compatible.chat-completions.v1";
const MAX_REQUEST_BODY_BYTES: usize = 1024 * 1024;
const MAX_RESPONSE_BODY_BYTES: usize = 8 * 1024 * 1024;
const MAX_API_KEY_BYTES: usize = 16 * 1024;
const MAX_CANCELLATION_ENTRIES: usize = 256;
const CANCELLATION_TOMBSTONE_TTL: Duration = Duration::from_secs(30);

struct ProviderGatewayCancellation {
    sender: watch::Sender<bool>,
    registered: bool,
    created_at: Instant,
}

#[derive(Default)]
pub struct ProviderGatewayState {
    cancellations: Arc<Mutex<HashMap<String, ProviderGatewayCancellation>>>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data", rename_all = "kebab-case")]
pub enum ProviderGatewayEvent {
    ResponseStart {
        status: u16,
        #[serde(rename = "contentType")]
        content_type: Option<String>,
    },
    BodyChunk {
        bytes: Vec<u8>,
    },
    Done,
}

fn validate_request_id(request_id: &str) -> Result<(), String> {
    if request_id.is_empty()
        || request_id.len() > 128
        || !request_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    {
        return Err("Provider gateway request ID is invalid".to_string());
    }
    Ok(())
}

fn ipv4_is_public_global(address: Ipv4Addr) -> bool {
    let [a, b, c, _d] = address.octets();
    !(a == 0
        || a == 10
        || a == 127
        || (a == 100 && (64..=127).contains(&b))
        || (a == 169 && b == 254)
        || (a == 172 && (16..=31).contains(&b))
        || (a == 192 && b == 0)
        || (a == 192 && b == 168)
        || (a == 192 && b == 88 && c == 99)
        || (a == 192 && b == 0 && c == 2)
        || (a == 198 && (b == 18 || b == 19))
        || (a == 198 && b == 51 && c == 100)
        || (a == 203 && b == 0 && c == 113)
        || a >= 224)
}

fn ipv6_is_public_global(address: Ipv6Addr) -> bool {
    if let Some(mapped) = address.to_ipv4_mapped() {
        return ipv4_is_public_global(mapped);
    }
    let segments = address.segments();
    let first = segments[0];
    let second = segments[1];
    let is_global_unicast = (0x2000..=0x3fff).contains(&first);
    let is_iana_protocol_assignment = first == 0x2001 && second <= 0x01ff;
    let is_deprecated_6to4 = first == 0x2002;
    let is_documentation =
        (first == 0x2001 && second == 0x0db8) || (first == 0x3fff && (second & 0xf000) == 0);
    is_global_unicast && !is_iana_protocol_assignment && !is_deprecated_6to4 && !is_documentation
}

fn address_is_public_global(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => ipv4_is_public_global(address),
        IpAddr::V6(address) => ipv6_is_public_global(address),
    }
}

fn validate_resolved_addresses(addresses: &[SocketAddr]) -> Result<(), String> {
    if addresses.is_empty() {
        return Err("Provider gateway DNS lookup returned no addresses".to_string());
    }
    if addresses
        .iter()
        .any(|address| !address_is_public_global(address.ip()))
    {
        return Err("Provider gateway rejected a non-global or mixed DNS resolution".to_string());
    }
    Ok(())
}

fn parse_canonical_origin(origin: &str) -> Result<(reqwest::Url, String, u16), String> {
    let parsed = reqwest::Url::parse(origin)
        .map_err(|_| "Provider gateway origin is invalid".to_string())?;
    if parsed.scheme() != "https"
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.path() != "/"
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || parsed.origin().ascii_serialization() != origin
    {
        return Err("Provider gateway requires a canonical HTTPS host-and-port origin".to_string());
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| "Provider gateway origin is missing a host".to_string())?
        .to_string();
    let port = parsed
        .port_or_known_default()
        .ok_or_else(|| "Provider gateway origin is missing a port".to_string())?;
    Ok((parsed, host, port))
}

async fn register_cancellation(
    state: &ProviderGatewayState,
    request_id: &str,
) -> Result<watch::Receiver<bool>, String> {
    let mut cancellations = state.cancellations.lock().await;
    prune_cancellation_tombstones(&mut cancellations);
    if let Some(existing) = cancellations.get(request_id) {
        if existing.registered {
            return Err("Provider gateway request ID is already active".to_string());
        }
    }
    if let Some(existing) = cancellations.get_mut(request_id) {
        existing.registered = true;
        return Ok(existing.sender.subscribe());
    }
    evict_oldest_cancellation_tombstone_if_full(&mut cancellations);
    if cancellations.len() >= MAX_CANCELLATION_ENTRIES {
        return Err("Provider gateway has too many pending cancellation records".to_string());
    }
    let (sender, receiver) = watch::channel(false);
    cancellations.insert(
        request_id.to_string(),
        ProviderGatewayCancellation {
            sender,
            registered: true,
            created_at: Instant::now(),
        },
    );
    Ok(receiver)
}

fn prune_cancellation_tombstones(cancellations: &mut HashMap<String, ProviderGatewayCancellation>) {
    cancellations.retain(|_, cancellation| {
        cancellation.registered || cancellation.created_at.elapsed() < CANCELLATION_TOMBSTONE_TTL
    });
}

fn evict_oldest_cancellation_tombstone_if_full(
    cancellations: &mut HashMap<String, ProviderGatewayCancellation>,
) {
    if cancellations.len() < MAX_CANCELLATION_ENTRIES {
        return;
    }
    let oldest_request_id = cancellations
        .iter()
        .filter(|(_, cancellation)| !cancellation.registered)
        .min_by_key(|(_, cancellation)| cancellation.created_at)
        .map(|(request_id, _)| request_id.clone());
    if let Some(request_id) = oldest_request_id {
        cancellations.remove(&request_id);
    }
}

async fn request_cancellation(
    state: &ProviderGatewayState,
    request_id: &str,
) -> Result<(), String> {
    let mut cancellations = state.cancellations.lock().await;
    prune_cancellation_tombstones(&mut cancellations);
    if let Some(cancellation) = cancellations.get(request_id) {
        cancellation.sender.send_replace(true);
        return Ok(());
    }
    evict_oldest_cancellation_tombstone_if_full(&mut cancellations);
    if cancellations.len() >= MAX_CANCELLATION_ENTRIES {
        return Err("Provider gateway has too many pending cancellation records".to_string());
    }
    cancellations.insert(
        request_id.to_string(),
        ProviderGatewayCancellation {
            sender: watch::channel(true).0,
            registered: false,
            created_at: Instant::now(),
        },
    );
    Ok(())
}

async fn wait_for_cancellation(cancellation: &mut watch::Receiver<bool>) {
    if *cancellation.borrow() {
        return;
    }
    while cancellation.changed().await.is_ok() {
        if *cancellation.borrow() {
            return;
        }
    }
}

#[tauri::command]
pub async fn cancel_provider_gateway_request(
    request_id: String,
    state: tauri::State<'_, ProviderGatewayState>,
) -> Result<(), String> {
    validate_request_id(&request_id)?;
    request_cancellation(&state, &request_id).await
}

#[tauri::command]
pub async fn provider_gateway_request(
    request_id: String,
    adapter_id: String,
    origin: String,
    operation: String,
    api_key: String,
    body: Option<String>,
    on_event: Channel<ProviderGatewayEvent>,
    state: tauri::State<'_, ProviderGatewayState>,
) -> Result<(), String> {
    validate_request_id(&request_id)?;
    if adapter_id != COMPILED_ADAPTER_ID {
        return Err("Provider gateway adapter is not compiled into this release".to_string());
    }
    if api_key.len() > MAX_API_KEY_BYTES {
        return Err("Provider gateway credential exceeds its size limit".to_string());
    }
    if body
        .as_ref()
        .is_some_and(|value| value.len() > MAX_REQUEST_BODY_BYTES)
    {
        return Err("Provider gateway request exceeds its body limit".to_string());
    }
    let (origin_url, host, port) = parse_canonical_origin(&origin)?;
    let (method, path) = match operation.as_str() {
        "probe" => (reqwest::Method::GET, "/v1/models"),
        "request" => (reqwest::Method::POST, "/v1/chat/completions"),
        _ => {
            return Err(
                "Provider gateway operation is not supported by the compiled adapter".to_string(),
            )
        }
    };
    let request_url = origin_url
        .join(path)
        .map_err(|_| "Provider gateway could not compile the request URL".to_string())?;
    if request_url.origin() != origin_url.origin() {
        return Err("Provider gateway refused to forward a request across origins".to_string());
    }

    let mut cancellation = register_cancellation(&state, &request_id).await?;
    let result = async {
        let mut addresses: Vec<SocketAddr> = tokio::net::lookup_host((host.as_str(), port))
            .await
            .map_err(|_| "Provider gateway DNS lookup failed".to_string())?
            .collect();
        addresses.sort_unstable();
        addresses.dedup();
        validate_resolved_addresses(&addresses)?;

        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .resolve_to_addrs(&host, &addresses)
            .build()
            .map_err(|_| "Provider gateway transport could not be initialized".to_string())?;
        let mut request = client
            .request(method, request_url)
            .header("Accept", "application/json, text/event-stream");
        if !api_key.is_empty() {
            request = request.bearer_auth(api_key);
        }
        if let Some(body) = body {
            request = request
                .header("Content-Type", "application/json")
                .body(body);
        }

        let response = tokio::select! {
            biased;
            _ = wait_for_cancellation(&mut cancellation) => {
                return Err("Provider gateway request was cancelled".to_string());
            }
            response = request.send() => {
                response.map_err(|_| "Provider gateway request failed".to_string())?
            }
        };
        let status = response.status().as_u16();
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(ToString::to_string);
        on_event
            .send(ProviderGatewayEvent::ResponseStart {
                status,
                content_type,
            })
            .map_err(|_| "Provider gateway response channel closed".to_string())?;

        let mut response_bytes = 0usize;
        let mut stream = response.bytes_stream();
        loop {
            let next = tokio::select! {
                biased;
                _ = wait_for_cancellation(&mut cancellation) => {
                    return Err("Provider gateway request was cancelled".to_string());
                }
                next = stream.next() => next,
            };
            let Some(chunk) = next else {
                break;
            };
            let chunk = chunk.map_err(|_| "Provider gateway response stream failed".to_string())?;
            response_bytes = response_bytes
                .checked_add(chunk.len())
                .ok_or_else(|| "Provider gateway response exceeded its size limit".to_string())?;
            if response_bytes > MAX_RESPONSE_BODY_BYTES {
                return Err("Provider gateway response exceeded its size limit".to_string());
            }
            on_event
                .send(ProviderGatewayEvent::BodyChunk {
                    bytes: chunk.to_vec(),
                })
                .map_err(|_| "Provider gateway response channel closed".to_string())?;
        }
        on_event
            .send(ProviderGatewayEvent::Done)
            .map_err(|_| "Provider gateway response channel closed".to_string())?;
        Ok(())
    }
    .await;
    state.cancellations.lock().await.remove(&request_id);
    result
}

#[cfg(test)]
mod tests {
    use super::{
        parse_canonical_origin, register_cancellation, request_cancellation,
        validate_resolved_addresses, ProviderGatewayState, CANCELLATION_TOMBSTONE_TTL,
        MAX_CANCELLATION_ENTRIES,
    };
    use std::net::SocketAddr;
    use std::time::{Duration, Instant};

    #[test]
    fn provider_gateway_accepts_only_canonical_https_origins() {
        assert!(parse_canonical_origin("https://api.example.com:8443").is_ok());
        for rejected in [
            "http://api.example.com",
            "https://api.example.com/v1",
            "https://user@api.example.com",
            "https://api.example.com?next=https://evil.example",
        ] {
            assert!(
                parse_canonical_origin(rejected).is_err(),
                "accepted {rejected}"
            );
        }
    }

    #[test]
    fn provider_gateway_rejects_private_metadata_and_mixed_resolution() {
        let public: SocketAddr = "8.8.8.8:443".parse().expect("public fixture");
        let private: SocketAddr = "10.0.0.2:443".parse().expect("private fixture");
        let metadata: SocketAddr = "169.254.169.254:443".parse().expect("metadata fixture");
        assert!(validate_resolved_addresses(&[public]).is_ok());
        assert!(validate_resolved_addresses(&[private]).is_err());
        assert!(validate_resolved_addresses(&[metadata]).is_err());
        assert!(validate_resolved_addresses(&[public, private]).is_err());
        for rejected in ["192.88.99.2:443", "198.51.100.1:443", "203.0.113.1:443"] {
            let address: SocketAddr = rejected.parse().expect("IANA IPv4 fixture");
            assert!(validate_resolved_addresses(&[address]).is_err());
        }
    }

    #[test]
    fn provider_gateway_rejects_iana_non_global_ipv6_ranges() {
        for rejected in [
            "[64:ff9b:1::1]:443",
            "[100::1]:443",
            "[2001:db8::1]:443",
            "[2002:a00:1::1]:443",
            "[3fff::1]:443",
            "[5f00::1]:443",
        ] {
            let address: SocketAddr = rejected.parse().expect("IPv6 fixture");
            assert!(
                validate_resolved_addresses(&[address]).is_err(),
                "accepted {rejected}"
            );
        }
        let public: SocketAddr = "[2606:4700:4700::1111]:443"
            .parse()
            .expect("public IPv6 fixture");
        assert!(validate_resolved_addresses(&[public]).is_ok());
    }

    #[tokio::test]
    async fn provider_gateway_rejects_duplicate_live_request_ids() {
        let state = ProviderGatewayState::default();
        let _first = register_cancellation(&state, "duplicate-live")
            .await
            .expect("first registration");

        assert!(register_cancellation(&state, "duplicate-live")
            .await
            .is_err());
    }

    #[tokio::test]
    async fn provider_gateway_tombstones_cannot_exhaust_live_registration() {
        let state = ProviderGatewayState::default();
        for index in 0..=MAX_CANCELLATION_ENTRIES {
            request_cancellation(&state, &format!("late-cancel-{index}"))
                .await
                .expect("bounded late cancellation");
        }
        let tombstone_count = state
            .cancellations
            .lock()
            .await
            .values()
            .filter(|cancellation| !cancellation.registered)
            .count();
        assert_eq!(tombstone_count, MAX_CANCELLATION_ENTRIES);

        assert!(register_cancellation(&state, "new-live").await.is_ok());
    }

    #[tokio::test]
    async fn provider_gateway_expires_unknown_tombstones_but_preserves_the_matching_race() {
        let state = ProviderGatewayState::default();
        request_cancellation(&state, "expired")
            .await
            .expect("initial tombstone");
        state
            .cancellations
            .lock()
            .await
            .get_mut("expired")
            .expect("stored tombstone")
            .created_at = Instant::now() - (CANCELLATION_TOMBSTONE_TTL + Duration::from_secs(1));

        let expired_receiver = register_cancellation(&state, "expired")
            .await
            .expect("expired tombstone must not cancel a reused ID");
        assert!(!*expired_receiver.borrow());

        request_cancellation(&state, "pre-registration")
            .await
            .expect("pre-registration cancellation");
        let receiver = register_cancellation(&state, "pre-registration")
            .await
            .expect("matching registration consumes tombstone");
        assert!(*receiver.borrow());
    }
}
