use crate::events::EventStream;
use futures_util::StreamExt;
use serde::Serialize;
use std::collections::HashMap;
use std::future::Future;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{watch, Mutex};
use uuid::Uuid;
use zeroize::Zeroizing;

const OPENAI_ADAPTER_ID: &str = "builtin.openai-compatible.chat-completions.v1";
const ANTHROPIC_ADAPTER_ID: &str = "builtin.anthropic.messages.v1";
const OPENAI_ORIGIN: &str = "https://api.openai.com";
const ANTHROPIC_ORIGIN: &str = "https://api.anthropic.com";
const MAX_REQUEST_BODY_BYTES: usize = 1024 * 1024;
const MAX_RESPONSE_BODY_BYTES: usize = 8 * 1024 * 1024;
const MAX_RESPONSE_EVENT_BYTES: usize = 64 * 1024;
const MAX_RESPONSE_EVENTS: u32 = 256;
const MAX_API_KEY_BYTES: usize = 16 * 1024;
const MAX_CANCELLATION_ENTRIES: usize = 256;
const MAX_CREDENTIAL_SESSIONS: usize = 8;
const CANCELLATION_TOMBSTONE_TTL: Duration = Duration::from_secs(30);

struct ProviderGatewayCancellation {
    sender: watch::Sender<bool>,
    registered: bool,
    session_id: Option<String>,
    created_at: Instant,
}

#[derive(Clone)]
struct ProviderCredentialSession {
    adapter_id: String,
    origin: String,
    api_key: Zeroizing<String>,
}

#[derive(Default)]
pub struct ProviderGatewayState {
    cancellations: Arc<Mutex<HashMap<String, ProviderGatewayCancellation>>>,
    sessions: Arc<Mutex<HashMap<String, ProviderCredentialSession>>>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data", rename_all = "kebab-case")]
pub enum ProviderGatewayEvent {
    ResponseStart {
        #[serde(rename = "requestId")]
        request_id: String,
        sequence: u32,
        status: u16,
        #[serde(rename = "contentType")]
        content_type: Option<String>,
    },
    BodyChunk {
        #[serde(rename = "requestId")]
        request_id: String,
        sequence: u32,
        bytes: Vec<u8>,
    },
    Done {
        #[serde(rename = "requestId")]
        request_id: String,
        sequence: u32,
    },
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

fn validate_session_id(session_id: &str) -> Result<(), String> {
    let Some(suffix) = session_id.strip_prefix("provider-session-") else {
        return Err("Provider gateway session ID is invalid".to_string());
    };
    if suffix.len() != 32 || !suffix.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("Provider gateway session ID is invalid".to_string());
    }
    Ok(())
}

fn validate_adapter(adapter_id: &str, origin: &str) -> Result<(), String> {
    match adapter_id {
        OPENAI_ADAPTER_ID => {
            parse_canonical_origin(origin)?;
        }
        ANTHROPIC_ADAPTER_ID => {
            if origin != ANTHROPIC_ORIGIN {
                return Err("Anthropic requires its compiled origin".to_string());
            }
        }
        _ => return Err("Provider gateway adapter is not compiled into this release".to_string()),
    }
    Ok(())
}

fn load_credential(source: &str) -> Result<String, String> {
    let (variable, required) = match source {
        "anthropic" => ("SOURDAW_ANTHROPIC_API_KEY", true),
        "openai" => ("SOURDAW_OPENAI_API_KEY", true),
        "openai-compatible" => ("SOURDAW_OPENAI_COMPATIBLE_API_KEY", false),
        _ => return Err("Provider gateway credential source is invalid".to_string()),
    };
    let credential = match std::env::var(variable) {
        Ok(value) => value,
        Err(std::env::VarError::NotPresent) if !required => String::new(),
        Err(_) => return Err("Provider gateway credential is unavailable".to_string()),
    };
    if credential.len() > MAX_API_KEY_BYTES {
        return Err("Provider gateway credential exceeds its size limit".to_string());
    }
    if required && credential.is_empty() {
        return Err("Provider gateway credential is unavailable".to_string());
    }
    Ok(credential)
}

fn validate_credential_binding(adapter_id: &str, origin: &str, source: &str) -> Result<(), String> {
    let valid = match source {
        "anthropic" => adapter_id == ANTHROPIC_ADAPTER_ID && origin == ANTHROPIC_ORIGIN,
        "openai" => adapter_id == OPENAI_ADAPTER_ID && origin == OPENAI_ORIGIN,
        "openai-compatible" => adapter_id == OPENAI_ADAPTER_ID,
        _ => false,
    };
    if !valid {
        return Err(
            "Provider gateway credential source does not match its adapter and origin".to_string(),
        );
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
    session_id: &str,
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
        existing.session_id = Some(session_id.to_string());
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
            session_id: Some(session_id.to_string()),
            created_at: Instant::now(),
        },
    );
    Ok(receiver)
}

async fn admit_provider_gateway_request(
    state: &ProviderGatewayState,
    request_id: &str,
    session_id: &str,
) -> Result<(ProviderCredentialSession, watch::Receiver<bool>), String> {
    let sessions = state.sessions.lock().await;
    let session = sessions
        .get(session_id)
        .cloned()
        .ok_or_else(|| "Provider gateway credential session is unavailable".to_string())?;
    let cancellation = register_cancellation(state, request_id, session_id).await?;
    drop(sessions);
    Ok((session, cancellation))
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
            session_id: None,
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

async fn await_provider_step_or_cancellation<T>(
    cancellation: &mut watch::Receiver<bool>,
    operation: impl Future<Output = Result<T, String>>,
) -> Result<T, String> {
    tokio::select! {
        biased;
        _ = wait_for_cancellation(cancellation) => {
            Err("Provider gateway request was cancelled".to_string())
        }
        result = operation => result,
    }
}

pub async fn cancel_provider_gateway_request(
    request_id: String,
    state: &ProviderGatewayState,
) -> Result<(), String> {
    validate_request_id(&request_id)?;
    request_cancellation(&state, &request_id).await
}

pub async fn open_provider_gateway_session(
    adapter_id: String,
    origin: String,
    credential_source: String,
    state: &ProviderGatewayState,
) -> Result<String, String> {
    validate_adapter(&adapter_id, &origin)?;
    validate_credential_binding(&adapter_id, &origin, &credential_source)?;
    let api_key = load_credential(&credential_source)?;
    open_provider_gateway_session_with_credential(adapter_id, origin, api_key, state).await
}

async fn open_provider_gateway_session_with_credential(
    adapter_id: String,
    origin: String,
    api_key: String,
    state: &ProviderGatewayState,
) -> Result<String, String> {
    validate_adapter(&adapter_id, &origin)?;
    if api_key.len() > MAX_API_KEY_BYTES
        || (adapter_id == ANTHROPIC_ADAPTER_ID && api_key.is_empty())
    {
        return Err("Provider gateway credential is invalid".to_string());
    }
    let mut sessions = state.sessions.lock().await;
    if sessions.len() >= MAX_CREDENTIAL_SESSIONS {
        return Err("Provider gateway has too many credential sessions".to_string());
    }
    let session_id = format!("provider-session-{}", Uuid::new_v4().simple());
    sessions.insert(
        session_id.clone(),
        ProviderCredentialSession {
            adapter_id,
            origin,
            api_key: Zeroizing::new(api_key),
        },
    );
    Ok(session_id)
}

pub async fn close_provider_gateway_session(
    session_id: String,
    state: &ProviderGatewayState,
) -> Result<(), String> {
    validate_session_id(&session_id)?;
    state.sessions.lock().await.remove(&session_id);
    let cancellations = state.cancellations.lock().await;
    for cancellation in cancellations.values() {
        if cancellation.session_id.as_deref() == Some(session_id.as_str()) {
            cancellation.sender.send_replace(true);
        }
    }
    Ok(())
}

pub async fn provider_gateway_request(
    request_id: String,
    session_id: String,
    operation: String,
    body: Option<String>,
    on_event: &dyn EventStream<ProviderGatewayEvent>,
    state: &ProviderGatewayState,
) -> Result<(), String> {
    validate_request_id(&request_id)?;
    validate_session_id(&session_id)?;
    let (session, mut cancellation) =
        admit_provider_gateway_request(state, &request_id, &session_id).await?;
    let result = async {
        if body
            .as_ref()
            .is_some_and(|value| value.len() > MAX_REQUEST_BODY_BYTES)
        {
            return Err("Provider gateway request exceeds its body limit".to_string());
        }
        let (origin_url, host, port) = parse_canonical_origin(&session.origin)?;
        let (method, path) = match (session.adapter_id.as_str(), operation.as_str()) {
            (OPENAI_ADAPTER_ID, "probe") => (reqwest::Method::GET, "/v1/models"),
            (OPENAI_ADAPTER_ID, "request") => (reqwest::Method::POST, "/v1/chat/completions"),
            (ANTHROPIC_ADAPTER_ID, "request") => (reqwest::Method::POST, "/v1/messages"),
            _ => {
                return Err(
                    "Provider gateway operation is not supported by the compiled adapter"
                        .to_string(),
                )
            }
        };
        let request_url = origin_url
            .join(path)
            .map_err(|_| "Provider gateway could not compile the request URL".to_string())?;
        if request_url.origin() != origin_url.origin() {
            return Err("Provider gateway refused to forward a request across origins".to_string());
        }

        let resolved_addresses = await_provider_step_or_cancellation(&mut cancellation, async {
            tokio::net::lookup_host((host.as_str(), port))
                .await
                .map_err(|_| "Provider gateway DNS lookup failed".to_string())
        })
        .await?;
        let mut addresses: Vec<SocketAddr> = resolved_addresses.collect();
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
        if !session.api_key.is_empty() {
            request = if session.adapter_id == ANTHROPIC_ADAPTER_ID {
                request
                    .header("anthropic-version", "2023-06-01")
                    .header("x-api-key", session.api_key.as_str())
            } else {
                request.bearer_auth(session.api_key.as_str())
            };
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
        let mut sequence = 0u32;
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(ToString::to_string);
        on_event
            .send(ProviderGatewayEvent::ResponseStart {
                request_id: request_id.clone(),
                sequence,
                status,
                content_type,
            })
            .map_err(|_| "Provider gateway response channel closed".to_string())?;
        sequence += 1;

        if !(200..300).contains(&status) {
            on_event
                .send(ProviderGatewayEvent::Done {
                    request_id: request_id.clone(),
                    sequence,
                })
                .map_err(|_| "Provider gateway response channel closed".to_string())?;
            return Ok(());
        }

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
            for event_chunk in chunk.chunks(MAX_RESPONSE_EVENT_BYTES) {
                if sequence >= MAX_RESPONSE_EVENTS {
                    return Err("Provider gateway response exceeded its event limit".to_string());
                }
                on_event
                    .send(ProviderGatewayEvent::BodyChunk {
                        request_id: request_id.clone(),
                        sequence,
                        bytes: event_chunk.to_vec(),
                    })
                    .map_err(|_| "Provider gateway response channel closed".to_string())?;
                sequence += 1;
            }
        }
        if sequence >= MAX_RESPONSE_EVENTS {
            return Err("Provider gateway response exceeded its event limit".to_string());
        }
        on_event
            .send(ProviderGatewayEvent::Done {
                request_id: request_id.clone(),
                sequence,
            })
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
        admit_provider_gateway_request, await_provider_step_or_cancellation,
        close_provider_gateway_session, open_provider_gateway_session_with_credential,
        parse_canonical_origin, register_cancellation, request_cancellation,
        validate_credential_binding, validate_resolved_addresses, ProviderGatewayEvent,
        ProviderGatewayState, ANTHROPIC_ADAPTER_ID, ANTHROPIC_ORIGIN, CANCELLATION_TOMBSTONE_TTL,
        MAX_CANCELLATION_ENTRIES, MAX_CREDENTIAL_SESSIONS, OPENAI_ADAPTER_ID, OPENAI_ORIGIN,
    };
    use std::net::SocketAddr;
    use std::time::{Duration, Instant};

    #[test]
    fn provider_gateway_serializes_correlated_stream_events() {
        assert_eq!(
            serde_json::to_value(ProviderGatewayEvent::BodyChunk {
                request_id: "request-1".to_string(),
                sequence: 2,
                bytes: vec![1, 2, 3],
            })
            .expect("provider gateway event must serialize"),
            serde_json::json!({
                "event": "body-chunk",
                "data": { "requestId": "request-1", "sequence": 2, "bytes": [1, 2, 3] }
            })
        );
    }

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
        let _first = register_cancellation(&state, "duplicate-live", "session-a")
            .await
            .expect("first registration");

        assert!(register_cancellation(&state, "duplicate-live", "session-a")
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

        assert!(register_cancellation(&state, "new-live", "session-a")
            .await
            .is_ok());
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

        let expired_receiver = register_cancellation(&state, "expired", "session-a")
            .await
            .expect("expired tombstone must not cancel a reused ID");
        assert!(!*expired_receiver.borrow());

        request_cancellation(&state, "pre-registration")
            .await
            .expect("pre-registration cancellation");
        let receiver = register_cancellation(&state, "pre-registration", "session-a")
            .await
            .expect("matching registration consumes tombstone");
        assert!(*receiver.borrow());
    }

    #[tokio::test]
    async fn provider_gateway_cancels_a_stalled_admission_step() {
        let (sender, mut receiver) = tokio::sync::watch::channel(false);
        let cancellation = async {
            tokio::task::yield_now().await;
            sender.send_replace(true);
        };
        let admission = await_provider_step_or_cancellation(
            &mut receiver,
            std::future::pending::<Result<(), String>>(),
        );

        let (result, ()) = tokio::join!(admission, cancellation);
        assert_eq!(
            result.expect_err("stalled admission must cancel"),
            "Provider gateway request was cancelled"
        );
    }

    #[tokio::test]
    async fn credential_sessions_are_opaque_bounded_and_revocable() {
        let state = ProviderGatewayState::default();
        let session_id = open_provider_gateway_session_with_credential(
            OPENAI_ADAPTER_ID.to_string(),
            "https://api.example.com".to_string(),
            "secret".to_string(),
            &state,
        )
        .await
        .expect("open session");

        assert!(session_id.starts_with("provider-session-"));
        assert!(!session_id.contains("secret"));
        assert_eq!(state.sessions.lock().await.len(), 1);

        close_provider_gateway_session(session_id.clone(), &state)
            .await
            .expect("close session");
        assert!(state.sessions.lock().await.is_empty());
        assert!(
            close_provider_gateway_session("not-a-session".to_string(), &state)
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn closing_a_credential_session_cancels_its_active_requests() {
        let state = ProviderGatewayState::default();
        let session_id = open_provider_gateway_session_with_credential(
            OPENAI_ADAPTER_ID.to_string(),
            OPENAI_ORIGIN.to_string(),
            "secret".to_string(),
            &state,
        )
        .await
        .expect("open session");
        let (_session, receiver) =
            admit_provider_gateway_request(&state, "active-request", &session_id)
                .await
                .expect("admit request");

        close_provider_gateway_session(session_id, &state)
            .await
            .expect("close session");

        assert!(*receiver.borrow());
    }

    #[tokio::test]
    async fn credential_sessions_enforce_compiled_adapter_policy() {
        let state = ProviderGatewayState::default();
        assert!(open_provider_gateway_session_with_credential(
            ANTHROPIC_ADAPTER_ID.to_string(),
            ANTHROPIC_ORIGIN.to_string(),
            "secret".to_string(),
            &state,
        )
        .await
        .is_ok());
        assert!(open_provider_gateway_session_with_credential(
            ANTHROPIC_ADAPTER_ID.to_string(),
            "https://proxy.example.com".to_string(),
            "secret".to_string(),
            &state,
        )
        .await
        .is_err());
        assert!(open_provider_gateway_session_with_credential(
            ANTHROPIC_ADAPTER_ID.to_string(),
            ANTHROPIC_ORIGIN.to_string(),
            String::new(),
            &state,
        )
        .await
        .is_err());
    }

    #[tokio::test]
    async fn credential_sessions_reject_unbounded_growth() {
        let state = ProviderGatewayState::default();
        for _ in 0..MAX_CREDENTIAL_SESSIONS {
            open_provider_gateway_session_with_credential(
                OPENAI_ADAPTER_ID.to_string(),
                OPENAI_ORIGIN.to_string(),
                "secret".to_string(),
                &state,
            )
            .await
            .expect("session within bound");
        }

        assert!(open_provider_gateway_session_with_credential(
            OPENAI_ADAPTER_ID.to_string(),
            OPENAI_ORIGIN.to_string(),
            "secret".to_string(),
            &state,
        )
        .await
        .is_err());
    }

    #[test]
    fn first_party_credentials_are_bound_to_first_party_origins() {
        assert!(validate_credential_binding(OPENAI_ADAPTER_ID, OPENAI_ORIGIN, "openai").is_ok());
        assert!(
            validate_credential_binding(ANTHROPIC_ADAPTER_ID, ANTHROPIC_ORIGIN, "anthropic")
                .is_ok()
        );
        assert!(validate_credential_binding(
            OPENAI_ADAPTER_ID,
            "https://provider.example",
            "openai-compatible"
        )
        .is_ok());
        assert!(validate_credential_binding(
            OPENAI_ADAPTER_ID,
            "https://provider.example",
            "openai"
        )
        .is_err());
        assert!(validate_credential_binding(
            ANTHROPIC_ADAPTER_ID,
            ANTHROPIC_ORIGIN,
            "openai-compatible"
        )
        .is_err());
    }
}
