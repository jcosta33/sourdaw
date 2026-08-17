use sourdaw_native::commands::provider_gateway as native;
use sourdaw_native::events::EventStream;
use tauri::ipc::Channel;

pub use sourdaw_native::commands::provider_gateway::{ProviderGatewayEvent, ProviderGatewayState};

/// One request's response channel, as the native crate's stream seam.
///
/// A closed channel is a failure here, not a dropped notification: the caller is
/// waiting for these events, and continuing to produce into a dead channel would
/// burn the remote budget for nothing.
struct ProviderGatewayChannel(Channel<ProviderGatewayEvent>);

impl EventStream<ProviderGatewayEvent> for ProviderGatewayChannel {
    fn send(&self, event: ProviderGatewayEvent) -> Result<(), String> {
        self.0
            .send(event)
            .map_err(|_| "Provider gateway response channel closed".to_string())
    }
}

#[tauri::command]
pub async fn open_provider_gateway_session(
    adapter_id: String,
    origin: String,
    credential_source: String,
    state: tauri::State<'_, ProviderGatewayState>,
) -> Result<String, String> {
    native::open_provider_gateway_session(adapter_id, origin, credential_source, &state).await
}

#[tauri::command]
pub async fn close_provider_gateway_session(
    session_id: String,
    state: tauri::State<'_, ProviderGatewayState>,
) -> Result<(), String> {
    native::close_provider_gateway_session(session_id, &state).await
}

#[tauri::command]
pub async fn cancel_provider_gateway_request(
    request_id: String,
    state: tauri::State<'_, ProviderGatewayState>,
) -> Result<(), String> {
    native::cancel_provider_gateway_request(request_id, &state).await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn provider_gateway_request(
    request_id: String,
    session_id: String,
    operation: String,
    body: Option<String>,
    on_event: Channel<ProviderGatewayEvent>,
    state: tauri::State<'_, ProviderGatewayState>,
) -> Result<(), String> {
    native::provider_gateway_request(
        request_id,
        session_id,
        operation,
        body,
        &ProviderGatewayChannel(on_event),
        &state,
    )
    .await
}
