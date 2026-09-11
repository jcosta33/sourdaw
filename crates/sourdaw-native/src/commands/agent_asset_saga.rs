//! Agent-driven asset effects, run as sagas over handles the user already approved.
//!
//! An agent that imports a sample or exports a stem is acting on the musician's
//! own files, and the two halves of that act fail differently: reading is one
//! step that either produced bytes or did not, while writing is a staged
//! effect whose visible half — replacing a file on disk — happens outside this
//! process' control of when the agent's run ends. Every command here therefore
//! answers with an [`AgentAssetSagaReceipt`] rather than with a bare success:
//! the receipt names what state the effect reached and what compensation is
//! still available for it, so a caller that crashed between staging and
//! finalizing can find the staged bytes again instead of leaving them behind.
//!
//! Domain outcomes are receipts, not errors. A refused path, an unknown
//! handle, a digest that did not match — each is something the caller asked
//! for and did not get, and each has to be reportable *with* its owner and its
//! compensation state. `Err` is reserved for input that never formed a
//! request at all: unparseable JSON, a malformed handle id, a payload over the
//! IPC limit.
//!
//! No command here takes a path except [`agent_asset_register_handle`], and
//! that one can only name a path the grant registry already admits. Every
//! other command takes an opaque handle id, so the only filenames an agent can
//! reach are the ones a user picked in a native dialog. A handle is re-checked
//! against the live registry at every use: a grant the user replaced or
//! dropped stops the handle with it, rather than leaving a minted id as a
//! standing capability.
//!
//! Handles are in-memory and session-scoped on purpose. Grants persist because
//! they record what a user chose; a handle records only that this process
//! resolved that choice once, and restoring one across a launch would be
//! claiming an approval the registry is the sole record of.

use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{OnceLock, RwLock, RwLockReadGuard, RwLockWriteGuard};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use super::filesystem::grant_registry::{self, GrantMode};
use super::filesystem::{
    ensure_file_ipc_size, ipc_temp_dir, replace_file_atomically, resolve_existing_file_path,
    resolve_writable_file_path,
};

/// Prefix every handle id carries, so a caller cannot pass a path where a
/// handle belongs and have it read as one.
const HANDLE_ID_PREFIX: &str = "asset-handle-";

/// Prefix every saga id carries, for the same reason.
const SAGA_ID_PREFIX: &str = "asset-saga-";

/// Directory under the IPC scratch root that staged export bytes live in.
const STAGING_DIR_NAME: &str = "agent-asset-saga";

const OPERATION_REGISTER_HANDLE: &str = "register-handle";
const OPERATION_IMPORT: &str = "import";
const OPERATION_STAGE_EXPORT: &str = "stage-export";
const OPERATION_FINALIZE_EXPORT: &str = "finalize-export";
const OPERATION_CLEANUP: &str = "cleanup";

/// Chunk size for the staged-to-destination copy. The staged file is already
/// bounded by the IPC limit, but streaming it keeps a gigabyte export off the
/// heap a second time.
const COPY_CHUNK_BYTES: usize = 64 * 1024;

/// The caller's work identity, echoed back verbatim in every receipt.
///
/// Copied rather than interpreted: this module never asks whether a run is
/// still live, whether a lease is still held, or whether a cancellation has
/// since advanced. A receipt is evidence of what the filesystem did, and
/// deciding whether that evidence still counts belongs to whoever owns the
/// run — a decision this side cannot make correctly, because by the time the
/// receipt is read the answer may have changed again.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentWorkOwner {
    pub run_id: String,
    pub work_id: String,
    pub lease_id: String,
    pub cancellation_generation: u64,
}

/// What a handle permits. Mirrors [`GrantMode`] rather than reusing it: the
/// wire form is the agent-facing spelling, and a handle is not a grant.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AssetHandleMode {
    Read,
    ReadWrite,
}

impl AssetHandleMode {
    fn grant_mode(self) -> GrantMode {
        match self {
            Self::Read => GrantMode::Read,
            Self::ReadWrite => GrantMode::ReadWrite,
        }
    }

    fn parse(mode: &str) -> Result<Self, String> {
        match mode {
            "read" => Ok(Self::Read),
            "read-write" => Ok(Self::ReadWrite),
            other => Err(format!("Unknown asset handle mode: {other}")),
        }
    }
}

/// Where an effect got to.
///
/// `ExternalPending` is the one that earns the saga: the bytes exist and are
/// verified, but nothing outside this process has seen them yet, so the effect
/// is neither done nor undone until a finalize or a cleanup says so.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentAssetSagaState {
    Committed,
    ExternalPending,
    Failed,
    Refused,
}

/// What undoing this effect would still take.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentAssetCompensation {
    NotNeeded,
    Available,
    Completed,
}

/// Why an effect did not reach its state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentAssetFailureKind {
    HandleUnknown,
    AccessDenied,
    MetadataMismatch,
    VerificationFailed,
    AuthorizationRequired,
    AlreadyOwned,
    IoError,
}

/// What the bytes themselves say they are, derived from the bytes and nothing
/// else. A field is `None` when the bytes did not answer it, never a guess
/// from a filename or from what the caller declared.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAssetMetadata {
    pub byte_length: u64,
    pub format: Option<String>,
    pub sample_rate: Option<u32>,
    pub channels: Option<u16>,
    pub frame_count: Option<u64>,
}

/// What the caller believes the bytes are. Every field is optional; each one
/// supplied is checked against the derived value and a disagreement refuses
/// the import rather than registering the caller's version of it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentAssetDeclaredMetadata {
    pub byte_length: Option<u64>,
    pub format: Option<String>,
    pub sample_rate: Option<u32>,
    pub channels: Option<u16>,
}

/// Whether the caller has authority to replace an existing destination.
///
/// Explicit and required, because overwriting is the one step of an export
/// that destroys something the musician already had.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentAssetExportAuthorization {
    pub overwrite: bool,
}

/// One command's answer: what was attempted, what state it reached, and what
/// can still be done about it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAssetSagaReceipt {
    pub saga_id: String,
    pub owner: AgentWorkOwner,
    pub operation: String,
    pub state: AgentAssetSagaState,
    pub compensation: AgentAssetCompensation,
    pub handle_id: Option<String>,
    pub asset_id: Option<String>,
    pub content_hash: Option<String>,
    pub metadata: Option<AgentAssetMetadata>,
    pub failure: Option<AgentAssetFailureKind>,
    pub message: Option<String>,
    pub finalize_owner: Option<String>,
    pub cleanup_owner: Option<String>,
}

impl AgentAssetSagaReceipt {
    fn new(
        saga_id: String,
        owner: AgentWorkOwner,
        operation: &str,
        state: AgentAssetSagaState,
        compensation: AgentAssetCompensation,
    ) -> Self {
        Self {
            saga_id,
            owner,
            operation: operation.to_string(),
            state,
            compensation,
            handle_id: None,
            asset_id: None,
            content_hash: None,
            metadata: None,
            failure: None,
            message: None,
            finalize_owner: None,
            cleanup_owner: None,
        }
    }

    /// A receipt for an outcome the caller did not get.
    ///
    /// `state` is passed rather than derived from `failure`, because the two
    /// are independent: the same `AccessDenied` is a `Failed` register-handle
    /// (the operation could not be performed) and a `Refused` finalize (the
    /// caller has no authority over that saga). Deriving one from the other
    /// would report the wrong half of that distinction on one of them.
    fn unmet(
        saga_id: String,
        owner: AgentWorkOwner,
        operation: &str,
        state: AgentAssetSagaState,
        failure: AgentAssetFailureKind,
        compensation: AgentAssetCompensation,
        message: String,
    ) -> Self {
        let mut receipt = Self::new(saga_id, owner, operation, state, compensation);
        receipt.failure = Some(failure);
        receipt.message = Some(message);
        receipt
    }

    fn failed(
        saga_id: String,
        owner: AgentWorkOwner,
        operation: &str,
        failure: AgentAssetFailureKind,
        compensation: AgentAssetCompensation,
        message: String,
    ) -> Self {
        Self::unmet(
            saga_id,
            owner,
            operation,
            AgentAssetSagaState::Failed,
            failure,
            compensation,
            message,
        )
    }

    fn refused(
        saga_id: String,
        owner: AgentWorkOwner,
        operation: &str,
        failure: AgentAssetFailureKind,
        compensation: AgentAssetCompensation,
        message: String,
    ) -> Self {
        Self::unmet(
            saga_id,
            owner,
            operation,
            AgentAssetSagaState::Refused,
            failure,
            compensation,
            message,
        )
    }
}

/// A path this process resolved once, for as long as the registry keeps
/// admitting it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AssetHandle {
    pub(crate) canonical: PathBuf,
    pub(crate) mode: AssetHandleMode,
}

/// What an imported asset's content address resolves to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RegisteredAsset {
    pub(crate) handle_id: String,
    pub(crate) metadata: AgentAssetMetadata,
}

/// One staged export, between its bytes landing and the destination changing.
#[derive(Debug, Clone, PartialEq, Eq)]
struct SagaRow {
    owner: AgentWorkOwner,
    /// `None` once the staged bytes are gone — finalized, cleaned up, or never
    /// kept. It is also what tells the sweep which staged files are still live.
    staged_path: Option<PathBuf>,
    destination_handle: String,
    expected_sha256: String,
    finalize_owner: Option<String>,
    cleanup_owner: Option<String>,
}

static HANDLES: OnceLock<RwLock<HashMap<String, AssetHandle>>> = OnceLock::new();
static ASSETS: OnceLock<RwLock<HashMap<String, RegisteredAsset>>> = OnceLock::new();
static SAGAS: OnceLock<RwLock<HashMap<String, SagaRow>>> = OnceLock::new();

fn handles() -> &'static RwLock<HashMap<String, AssetHandle>> {
    HANDLES.get_or_init(|| RwLock::new(HashMap::new()))
}

fn assets() -> &'static RwLock<HashMap<String, RegisteredAsset>> {
    ASSETS.get_or_init(|| RwLock::new(HashMap::new()))
}

fn sagas() -> &'static RwLock<HashMap<String, SagaRow>> {
    SAGAS.get_or_init(|| RwLock::new(HashMap::new()))
}

fn read_handles() -> RwLockReadGuard<'static, HashMap<String, AssetHandle>> {
    handles()
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn write_handles() -> RwLockWriteGuard<'static, HashMap<String, AssetHandle>> {
    handles()
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
fn read_assets() -> RwLockReadGuard<'static, HashMap<String, RegisteredAsset>> {
    assets()
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn write_assets() -> RwLockWriteGuard<'static, HashMap<String, RegisteredAsset>> {
    assets()
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn read_sagas() -> RwLockReadGuard<'static, HashMap<String, SagaRow>> {
    sagas()
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn write_sagas() -> RwLockWriteGuard<'static, HashMap<String, SagaRow>> {
    sagas()
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// What an asset id resolves to, for tests.
#[cfg(test)]
pub(crate) fn registered_asset(asset_id: &str) -> Option<RegisteredAsset> {
    read_assets().get(asset_id).cloned()
}

/// Install an explicit handle set for the duration of `body`, for tests only.
///
/// The three maps and the staging directory are process-global, so the swap is
/// serialized: two tests holding different handle sets at once would each see
/// the other's, and the orphan sweep would reach the other's staged files.
#[cfg(test)]
pub(crate) fn with_handles_for_test<T>(
    handles: HashMap<String, AssetHandle>,
    body: impl FnOnce() -> T,
) -> T {
    use std::sync::Mutex;

    static TEST_LOCK: Mutex<()> = Mutex::new(());
    let _serialized = TEST_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    let reset = || {
        write_assets().clear();
        write_sagas().clear();
        let _ = fs::remove_dir_all(staging_root());
    };

    reset();
    *write_handles() = handles;
    let outcome = body();
    write_handles().clear();
    reset();
    outcome
}

/// Where staged export bytes live: inside the IPC scratch root, which is the
/// app's own storage rather than anywhere the user keeps work.
fn staging_root() -> PathBuf {
    ipc_temp_dir().join(STAGING_DIR_NAME)
}

fn staged_path_for(saga_id: &str) -> PathBuf {
    staging_root().join(format!("{saga_id}.tmp"))
}

fn new_handle_id() -> String {
    format!("{HANDLE_ID_PREFIX}{}", uuid::Uuid::new_v4())
}

fn new_saga_id() -> String {
    format!("{SAGA_ID_PREFIX}{}", uuid::Uuid::new_v4())
}

/// Refuse anything that is not this module's own id shape, before it is used
/// to look anything up.
///
/// A prefix test alone would admit `asset-handle-../../etc/passwd`; parsing the
/// remainder as a UUID is what makes the id a name this process minted rather
/// than a string a caller composed. Nothing downstream builds a path from a
/// caller-supplied id, and this keeps it that way by construction.
fn validate_handle_id(handle_id: &str) -> Result<(), String> {
    let malformed = || "Asset handle id is malformed".to_string();
    let suffix = handle_id
        .strip_prefix(HANDLE_ID_PREFIX)
        .ok_or_else(malformed)?;
    uuid::Uuid::parse_str(suffix).map_err(|_| malformed())?;
    Ok(())
}

fn parse_owner(owner: Value) -> Result<AgentWorkOwner, String> {
    serde_json::from_value(owner).map_err(|error| format!("Agent work owner is malformed: {error}"))
}

/// A 64-character lowercase hex digest and nothing else.
///
/// Lowercase specifically: the digests this module produces are lowercase, and
/// admitting an uppercase spelling would make two strings for one digest that
/// compare unequal everywhere the comparison is a string comparison.
fn validate_sha256(expected: &str) -> Result<(), String> {
    let is_lower_hex = expected
        .bytes()
        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte));
    if expected.len() != 64 || !is_lower_hex {
        return Err("Expected SHA-256 must be a 64-character lowercase hex digest".to_string());
    }
    Ok(())
}

fn hex_digest(bytes: impl AsRef<[u8]>) -> String {
    bytes
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// Why a handle did not resolve: it was never minted, or the grant behind it
/// no longer admits what it names.
enum HandleRefusal {
    Unknown,
    AccessDenied(String),
}

impl HandleRefusal {
    fn failure(&self) -> AgentAssetFailureKind {
        match self {
            Self::Unknown => AgentAssetFailureKind::HandleUnknown,
            Self::AccessDenied(_) => AgentAssetFailureKind::AccessDenied,
        }
    }

    fn message(self) -> String {
        match self {
            Self::Unknown => "No asset handle with that id".to_string(),
            Self::AccessDenied(message) => message,
        }
    }
}

/// Resolve a handle at `mode`, re-checking the grant that justified it.
///
/// The registry check is not a repeat of the mint-time one: a grant can be
/// replaced by a narrower pick or dropped between the two, and a handle that
/// kept working past that would be a capability outliving the approval it was
/// cut from.
fn resolve_handle(handle_id: &str, mode: AssetHandleMode) -> Result<PathBuf, HandleRefusal> {
    let handle = read_handles()
        .get(handle_id)
        .cloned()
        .ok_or(HandleRefusal::Unknown)?;

    if mode == AssetHandleMode::ReadWrite && handle.mode == AssetHandleMode::Read {
        return Err(HandleRefusal::AccessDenied(
            "Asset handle is read-only".to_string(),
        ));
    }
    if !grant_registry::admits(&handle.canonical, mode.grant_mode()) {
        return Err(HandleRefusal::AccessDenied(
            "Asset handle is no longer granted".to_string(),
        ));
    }
    Ok(handle.canonical)
}

/// What the bytes say they are. WAV is recognised by parsing it, so a file
/// named `.wav` that is not one reports no format rather than a format it
/// cannot back up.
fn derive_metadata(bytes: &[u8]) -> AgentAssetMetadata {
    let mut metadata = AgentAssetMetadata {
        byte_length: bytes.len() as u64,
        format: None,
        sample_rate: None,
        channels: None,
        frame_count: None,
    };

    if let Ok(reader) = hound::WavReader::new(std::io::Cursor::new(bytes)) {
        let spec = reader.spec();
        metadata.format = Some("wav".to_string());
        metadata.sample_rate = Some(spec.sample_rate);
        metadata.channels = Some(spec.channels);
        metadata.frame_count = Some(u64::from(reader.duration()));
    }

    metadata
}

/// The first declared field the bytes disagree with, by its wire name.
fn declared_mismatch(
    declared: &AgentAssetDeclaredMetadata,
    derived: &AgentAssetMetadata,
) -> Option<&'static str> {
    if matches!(declared.byte_length, Some(value) if value != derived.byte_length) {
        return Some("byteLength");
    }
    if declared.format.is_some() && declared.format != derived.format {
        return Some("format");
    }
    if declared.sample_rate.is_some() && declared.sample_rate != derived.sample_rate {
        return Some("sampleRate");
    }
    if declared.channels.is_some() && declared.channels != derived.channels {
        return Some("channels");
    }
    None
}

/// Mint a handle for one path the user already granted.
///
/// The only command here that takes a path, and it cannot widen anything: the
/// resolver applies the private-state refusal and the allowed roots, and the
/// registry check after it means a handle exists only where a user's own pick
/// reaches. A built-in root is deliberately not enough — a handle must be
/// revocable, and only a grant can be revoked.
pub async fn agent_asset_register_handle(
    path: String,
    mode: String,
    owner: Value,
) -> Result<AgentAssetSagaReceipt, String> {
    let owner = parse_owner(owner)?;
    let mode = AssetHandleMode::parse(&mode)?;
    let saga_id = new_saga_id();

    let resolved = match mode {
        AssetHandleMode::Read => resolve_existing_file_path(&path),
        AssetHandleMode::ReadWrite => resolve_writable_file_path(&path),
    };
    let canonical = match resolved {
        Ok(canonical) => canonical,
        Err(message) => {
            return Ok(AgentAssetSagaReceipt::failed(
                saga_id,
                owner,
                OPERATION_REGISTER_HANDLE,
                AgentAssetFailureKind::AccessDenied,
                AgentAssetCompensation::NotNeeded,
                message,
            ));
        }
    };
    if !grant_registry::admits(&canonical, mode.grant_mode()) {
        return Ok(AgentAssetSagaReceipt::failed(
            saga_id,
            owner,
            OPERATION_REGISTER_HANDLE,
            AgentAssetFailureKind::AccessDenied,
            AgentAssetCompensation::NotNeeded,
            "Path is not covered by a file grant".to_string(),
        ));
    }

    let handle_id = new_handle_id();
    write_handles().insert(handle_id.clone(), AssetHandle { canonical, mode });

    let mut receipt = AgentAssetSagaReceipt::new(
        saga_id,
        owner,
        OPERATION_REGISTER_HANDLE,
        AgentAssetSagaState::Committed,
        AgentAssetCompensation::NotNeeded,
    );
    receipt.handle_id = Some(handle_id);
    Ok(receipt)
}

/// Read one granted file once, content-address it, and register what it is.
///
/// The hash, the metadata and the registered asset all come from the same
/// owned buffer. Re-opening the path to answer a second question would leave a
/// window where the file on disk is not the file the asset id names.
pub async fn agent_asset_import(
    handle_id: String,
    owner: Value,
    declared: Value,
) -> Result<AgentAssetSagaReceipt, String> {
    let owner = parse_owner(owner)?;
    validate_handle_id(&handle_id)?;
    let declared: AgentAssetDeclaredMetadata = serde_json::from_value(declared)
        .map_err(|error| format!("Declared asset metadata is malformed: {error}"))?;
    let saga_id = new_saga_id();

    let path = match resolve_handle(&handle_id, AssetHandleMode::Read) {
        Ok(path) => path,
        Err(refusal) => {
            let failure = refusal.failure();
            let mut receipt = AgentAssetSagaReceipt::refused(
                saga_id,
                owner,
                OPERATION_IMPORT,
                failure,
                AgentAssetCompensation::NotNeeded,
                refusal.message(),
            );
            receipt.handle_id = Some(handle_id);
            return Ok(receipt);
        }
    };

    let size = fs::metadata(&path)
        .map_err(|error| format!("Failed to read asset metadata: {error}"))?
        .len();
    ensure_file_ipc_size(size, "agent_asset_import")?;
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) => {
            let mut receipt = AgentAssetSagaReceipt::failed(
                saga_id,
                owner,
                OPERATION_IMPORT,
                AgentAssetFailureKind::IoError,
                AgentAssetCompensation::NotNeeded,
                format!("Failed to read the asset: {error}"),
            );
            receipt.handle_id = Some(handle_id);
            return Ok(receipt);
        }
    };

    let content_hash = hex_digest(Sha256::digest(&bytes));
    let metadata = derive_metadata(&bytes);

    if let Some(field) = declared_mismatch(&declared, &metadata) {
        let mut receipt = AgentAssetSagaReceipt::failed(
            saga_id,
            owner,
            OPERATION_IMPORT,
            AgentAssetFailureKind::MetadataMismatch,
            AgentAssetCompensation::NotNeeded,
            format!("Declared {field} does not match the asset bytes"),
        );
        receipt.handle_id = Some(handle_id);
        receipt.metadata = Some(metadata);
        return Ok(receipt);
    }

    let asset_id = format!("sha256:{content_hash}");
    write_assets().insert(
        asset_id.clone(),
        RegisteredAsset {
            handle_id: handle_id.clone(),
            metadata: metadata.clone(),
        },
    );

    let mut receipt = AgentAssetSagaReceipt::new(
        saga_id,
        owner,
        OPERATION_IMPORT,
        AgentAssetSagaState::Committed,
        AgentAssetCompensation::NotNeeded,
    );
    receipt.handle_id = Some(handle_id);
    receipt.asset_id = Some(asset_id);
    receipt.content_hash = Some(content_hash);
    receipt.metadata = Some(metadata);
    Ok(receipt)
}

/// Put the export's bytes somewhere durable and prove they are the bytes the
/// caller meant, without touching the destination.
///
/// The staged file is re-read and re-hashed rather than trusted from the
/// buffer that was just written: what the finalize will copy is the file, and
/// a disk that wrote something else is exactly the failure this is here to
/// catch before the musician's own file is replaced.
pub async fn agent_asset_stage_export(
    destination_handle_id: String,
    owner: Value,
    expected_sha256: String,
    data: &[u8],
) -> Result<AgentAssetSagaReceipt, String> {
    let owner = parse_owner(owner)?;
    validate_handle_id(&destination_handle_id)?;
    validate_sha256(&expected_sha256)?;
    ensure_file_ipc_size(data.len() as u64, "agent_asset_stage_export")?;
    let saga_id = new_saga_id();

    if let Err(refusal) = resolve_handle(&destination_handle_id, AssetHandleMode::ReadWrite) {
        let failure = refusal.failure();
        let mut receipt = AgentAssetSagaReceipt::refused(
            saga_id,
            owner,
            OPERATION_STAGE_EXPORT,
            failure,
            AgentAssetCompensation::NotNeeded,
            refusal.message(),
        );
        receipt.handle_id = Some(destination_handle_id);
        return Ok(receipt);
    }

    let staged_path = staged_path_for(&saga_id);
    write_sagas().insert(
        saga_id.clone(),
        SagaRow {
            owner: owner.clone(),
            staged_path: Some(staged_path.clone()),
            destination_handle: destination_handle_id.clone(),
            expected_sha256: expected_sha256.clone(),
            finalize_owner: None,
            cleanup_owner: None,
        },
    );

    if let Err(message) = write_staged_file(&staged_path, data) {
        forget_staged_bytes(&saga_id);
        let mut receipt = AgentAssetSagaReceipt::failed(
            saga_id,
            owner,
            OPERATION_STAGE_EXPORT,
            AgentAssetFailureKind::IoError,
            AgentAssetCompensation::Completed,
            message,
        );
        receipt.handle_id = Some(destination_handle_id);
        return Ok(receipt);
    }

    let staged_hash = match fs::read(&staged_path) {
        Ok(bytes) => hex_digest(Sha256::digest(&bytes)),
        Err(error) => {
            let _ = fs::remove_file(&staged_path);
            forget_staged_bytes(&saga_id);
            let mut receipt = AgentAssetSagaReceipt::failed(
                saga_id,
                owner,
                OPERATION_STAGE_EXPORT,
                AgentAssetFailureKind::IoError,
                AgentAssetCompensation::Completed,
                format!("Failed to re-read the staged asset: {error}"),
            );
            receipt.handle_id = Some(destination_handle_id);
            return Ok(receipt);
        }
    };

    if staged_hash != expected_sha256 {
        let _ = fs::remove_file(&staged_path);
        forget_staged_bytes(&saga_id);
        let mut receipt = AgentAssetSagaReceipt::failed(
            saga_id,
            owner,
            OPERATION_STAGE_EXPORT,
            AgentAssetFailureKind::VerificationFailed,
            AgentAssetCompensation::Completed,
            "Staged bytes did not match the expected digest".to_string(),
        );
        receipt.handle_id = Some(destination_handle_id);
        receipt.content_hash = Some(staged_hash);
        return Ok(receipt);
    }

    let mut receipt = AgentAssetSagaReceipt::new(
        saga_id,
        owner,
        OPERATION_STAGE_EXPORT,
        AgentAssetSagaState::ExternalPending,
        AgentAssetCompensation::Available,
    );
    receipt.handle_id = Some(destination_handle_id);
    receipt.content_hash = Some(expected_sha256);
    Ok(receipt)
}

/// Write the staged file, refusing to reuse a name that already exists.
fn write_staged_file(staged_path: &Path, data: &[u8]) -> Result<(), String> {
    if let Some(parent) = staged_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create the staging directory: {error}"))?;
    }
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(staged_path)
        .map_err(|error| format!("Failed to create the staged asset: {error}"))?;
    file.write_all(data)
        .map_err(|error| format!("Failed to write the staged asset: {error}"))?;
    file.sync_all()
        .map_err(|error| format!("Failed to sync the staged asset: {error}"))
}

/// Record that a saga no longer has staged bytes, keeping the row so a later
/// finalize or cleanup answers about a saga that existed rather than one that
/// never did.
fn forget_staged_bytes(saga_id: &str) {
    if let Some(row) = write_sagas().get_mut(saga_id) {
        row.staged_path = None;
    }
}

/// The outcome of trying to take the one finalize claim on a saga.
enum FinalizeClaim {
    Claimed(SagaRow),
    Refused(Box<AgentAssetSagaReceipt>),
}

/// Take the claim under one write lock, so two concurrent finalizes cannot
/// both find the saga unclaimed and both replace the destination.
fn claim_finalize(
    saga_id: &str,
    owner: &AgentWorkOwner,
) -> Result<FinalizeClaim, AgentAssetSagaReceipt> {
    let mut rows = write_sagas();
    let Some(row) = rows.get_mut(saga_id) else {
        return Err(AgentAssetSagaReceipt::refused(
            saga_id.to_string(),
            owner.clone(),
            OPERATION_FINALIZE_EXPORT,
            AgentAssetFailureKind::HandleUnknown,
            AgentAssetCompensation::NotNeeded,
            "No staged export with that saga id".to_string(),
        ));
    };

    if &row.owner != owner {
        let mut receipt = AgentAssetSagaReceipt::refused(
            saga_id.to_string(),
            owner.clone(),
            OPERATION_FINALIZE_EXPORT,
            AgentAssetFailureKind::AccessDenied,
            compensation_for(row),
            "Saga belongs to another work owner".to_string(),
        );
        receipt.handle_id = Some(row.destination_handle.clone());
        return Err(receipt);
    }

    if let Some(finalize_owner) = row.finalize_owner.clone() {
        let mut receipt = AgentAssetSagaReceipt::refused(
            saga_id.to_string(),
            owner.clone(),
            OPERATION_FINALIZE_EXPORT,
            AgentAssetFailureKind::AlreadyOwned,
            compensation_for(row),
            "Saga has already been finalized".to_string(),
        );
        receipt.handle_id = Some(row.destination_handle.clone());
        receipt.finalize_owner = Some(finalize_owner);
        receipt.cleanup_owner = row.cleanup_owner.clone();
        return Ok(FinalizeClaim::Refused(Box::new(receipt)));
    }

    row.finalize_owner = Some(owner.lease_id.clone());
    Ok(FinalizeClaim::Claimed(row.clone()))
}

/// What is still undoable about a saga: staged bytes exist, or they do not.
fn compensation_for(row: &SagaRow) -> AgentAssetCompensation {
    if row.staged_path.is_some() {
        AgentAssetCompensation::Available
    } else {
        AgentAssetCompensation::NotNeeded
    }
}

/// Release a claim a finalize did not consume.
///
/// A missing authorization is a precondition the caller can still supply, so
/// the saga has to stay finalizable; keeping the claim would strand staged
/// bytes that nothing is allowed to commit.
fn release_finalize_claim(saga_id: &str) {
    if let Some(row) = write_sagas().get_mut(saga_id) {
        row.finalize_owner = None;
    }
}

/// Replace the destination with the staged bytes, or leave it untouched.
///
/// The digest is computed over the bytes as they are copied and checked before
/// the closure returns, so a mismatch fails inside `replace_file_atomically`:
/// it unlinks its own sibling temp file and the destination never learns the
/// attempt happened. Hashing first and copying second would re-read the staged
/// file twice and leave a window between the two.
pub async fn agent_asset_finalize_export(
    saga_id: String,
    owner: Value,
    authorization: Value,
) -> Result<AgentAssetSagaReceipt, String> {
    let owner = parse_owner(owner)?;
    let authorization: AgentAssetExportAuthorization = serde_json::from_value(authorization)
        .map_err(|error| format!("Export authorization is malformed: {error}"))?;

    let row = match claim_finalize(&saga_id, &owner) {
        Ok(FinalizeClaim::Claimed(row)) => row,
        Ok(FinalizeClaim::Refused(receipt)) => return Ok(*receipt),
        Err(receipt) => return Ok(receipt),
    };

    let outcome = finalize_claimed_saga(&saga_id, &owner, &authorization, &row);
    if outcome.state != AgentAssetSagaState::Committed
        && outcome.failure != Some(AgentAssetFailureKind::VerificationFailed)
    {
        release_finalize_claim(&saga_id);
    }
    Ok(outcome)
}

fn finalize_claimed_saga(
    saga_id: &str,
    owner: &AgentWorkOwner,
    authorization: &AgentAssetExportAuthorization,
    row: &SagaRow,
) -> AgentAssetSagaReceipt {
    // A saga-authority problem is a refusal; an operation that could not be
    // performed is a failure. Both carry the destination handle so a caller
    // can tell which export the receipt is about.
    let unmet = |state, failure, compensation, message: String| {
        let mut receipt = AgentAssetSagaReceipt::unmet(
            saga_id.to_string(),
            owner.clone(),
            OPERATION_FINALIZE_EXPORT,
            state,
            failure,
            compensation,
            message,
        );
        receipt.handle_id = Some(row.destination_handle.clone());
        receipt
    };

    let Some(staged_path) = row.staged_path.clone() else {
        return unmet(
            AgentAssetSagaState::Refused,
            AgentAssetFailureKind::HandleUnknown,
            AgentAssetCompensation::NotNeeded,
            "Saga has no staged bytes left to finalize".to_string(),
        );
    };

    let handle_path = match resolve_handle(&row.destination_handle, AssetHandleMode::ReadWrite) {
        Ok(path) => path,
        Err(refusal) => {
            let failure = refusal.failure();
            return unmet(
                AgentAssetSagaState::Refused,
                failure,
                AgentAssetCompensation::Available,
                refusal.message(),
            );
        }
    };
    let destination = match resolve_writable_file_path(&handle_path.to_string_lossy()) {
        Ok(destination) => destination,
        Err(message) => {
            return unmet(
                AgentAssetSagaState::Failed,
                AgentAssetFailureKind::AccessDenied,
                AgentAssetCompensation::Available,
                message,
            );
        }
    };

    if destination.exists() && !authorization.overwrite {
        return unmet(
            AgentAssetSagaState::Failed,
            AgentAssetFailureKind::AuthorizationRequired,
            AgentAssetCompensation::Available,
            "Destination exists and the caller did not authorize an overwrite".to_string(),
        );
    }

    let mismatch = std::cell::Cell::new(false);
    let written = replace_file_atomically(&destination, |file| {
        copy_verified(&staged_path, file, &row.expected_sha256, &mismatch)
    });
    if let Err(message) = written {
        let failure = if mismatch.get() {
            AgentAssetFailureKind::VerificationFailed
        } else {
            AgentAssetFailureKind::IoError
        };
        return unmet(
            AgentAssetSagaState::Failed,
            failure,
            AgentAssetCompensation::Available,
            message,
        );
    }

    let _ = fs::remove_file(&staged_path);
    if let Some(stored) = write_sagas().get_mut(saga_id) {
        stored.staged_path = None;
        stored.cleanup_owner = Some(owner.lease_id.clone());
    }

    let mut receipt = AgentAssetSagaReceipt::new(
        saga_id.to_string(),
        owner.clone(),
        OPERATION_FINALIZE_EXPORT,
        AgentAssetSagaState::Committed,
        AgentAssetCompensation::NotNeeded,
    );
    receipt.handle_id = Some(row.destination_handle.clone());
    receipt.content_hash = Some(row.expected_sha256.clone());
    receipt.finalize_owner = Some(owner.lease_id.clone());
    receipt.cleanup_owner = Some(owner.lease_id.clone());
    receipt
}

/// Copy the staged bytes into `file`, hashing them on the way, and refuse the
/// write if the digest is not the one the stage recorded.
fn copy_verified(
    staged_path: &Path,
    file: &mut fs::File,
    expected_sha256: &str,
    mismatch: &std::cell::Cell<bool>,
) -> Result<(), String> {
    let mut source = fs::File::open(staged_path)
        .map_err(|error| format!("Failed to open the staged asset: {error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; COPY_CHUNK_BYTES];

    loop {
        let read = source
            .read(&mut buffer)
            .map_err(|error| format!("Failed to read the staged asset: {error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        file.write_all(&buffer[..read])
            .map_err(|error| format!("Failed to write the destination: {error}"))?;
    }

    if hex_digest(hasher.finalize()) != expected_sha256 {
        mismatch.set(true);
        return Err("Staged bytes did not match the expected digest".to_string());
    }
    Ok(())
}

/// Drop staged bytes: one saga's, or every orphan under the staging root.
///
/// The sweep is what makes a crashed run recoverable rather than permanent:
/// staged files whose saga this process no longer has are bytes nothing can
/// finalize, and leaving them would grow the scratch root by one export per
/// abandoned run.
pub async fn agent_asset_cleanup(
    saga_id: Option<String>,
    owner: Value,
) -> Result<AgentAssetSagaReceipt, String> {
    let owner = parse_owner(owner)?;
    match saga_id {
        Some(saga_id) => Ok(cleanup_one_saga(saga_id, owner)),
        None => Ok(sweep_orphaned_stages(owner)),
    }
}

fn cleanup_one_saga(saga_id: String, owner: AgentWorkOwner) -> AgentAssetSagaReceipt {
    let claimed = {
        let mut rows = write_sagas();
        let Some(row) = rows.get_mut(&saga_id) else {
            return AgentAssetSagaReceipt::refused(
                saga_id,
                owner,
                OPERATION_CLEANUP,
                AgentAssetFailureKind::HandleUnknown,
                AgentAssetCompensation::NotNeeded,
                "No staged export with that saga id".to_string(),
            );
        };
        match row.cleanup_owner.clone() {
            Some(cleanup_owner) => Err((cleanup_owner, row.destination_handle.clone())),
            None => {
                row.cleanup_owner = Some(owner.lease_id.clone());
                Ok((row.staged_path.take(), row.destination_handle.clone()))
            }
        }
    };

    match claimed {
        Err((cleanup_owner, destination_handle)) => {
            let mut receipt = AgentAssetSagaReceipt::refused(
                saga_id,
                owner,
                OPERATION_CLEANUP,
                AgentAssetFailureKind::AlreadyOwned,
                AgentAssetCompensation::Completed,
                "Saga has already been cleaned up".to_string(),
            );
            receipt.handle_id = Some(destination_handle);
            receipt.cleanup_owner = Some(cleanup_owner);
            receipt
        }
        Ok((staged_path, destination_handle)) => {
            if let Some(staged_path) = staged_path {
                let _ = fs::remove_file(&staged_path);
            }
            let mut receipt = AgentAssetSagaReceipt::new(
                saga_id,
                owner.clone(),
                OPERATION_CLEANUP,
                AgentAssetSagaState::Committed,
                AgentAssetCompensation::Completed,
            );
            receipt.handle_id = Some(destination_handle);
            receipt.cleanup_owner = Some(owner.lease_id);
            receipt
        }
    }
}

fn sweep_orphaned_stages(owner: AgentWorkOwner) -> AgentAssetSagaReceipt {
    let live: Vec<PathBuf> = read_sagas()
        .values()
        .filter_map(|row| row.staged_path.clone())
        .collect();

    let mut removed = 0_u32;
    if let Ok(entries) = fs::read_dir(staging_root()) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("tmp") {
                continue;
            }
            if live.contains(&path) {
                continue;
            }
            if fs::remove_file(&path).is_ok() {
                removed += 1;
            }
        }
    }

    let mut receipt = AgentAssetSagaReceipt::new(
        new_saga_id(),
        owner,
        OPERATION_CLEANUP,
        AgentAssetSagaState::Committed,
        AgentAssetCompensation::Completed,
    );
    receipt.message = Some(format!("Removed {removed} orphaned staged asset files"));
    receipt
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::filesystem::grant_registry::{with_grants_for_test, FileGrant};

    /// A directory outside every built-in root, so what admits a path in a test
    /// is the grant the test installed and nothing the developer's machine
    /// happens to have.
    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn create() -> Self {
            let path =
                std::env::temp_dir().join(format!("sourdaw-agent-asset-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&path).expect("test directory should be created");
            let canonical = path
                .canonicalize()
                .expect("test directory should canonicalize");
            Self { path: canonical }
        }

        fn file(&self, name: &str, bytes: &[u8]) -> PathBuf {
            let path = self.path.join(name);
            fs::write(&path, bytes).expect("test file should be written");
            path
        }

        fn join(&self, name: &str) -> PathBuf {
            self.path.join(name)
        }

        fn grant(&self, mode: GrantMode) -> FileGrant {
            FileGrant {
                canonical: self.path.clone(),
                mode,
                recursive: true,
            }
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn owner_named(lease_id: &str) -> AgentWorkOwner {
        AgentWorkOwner {
            run_id: "run-77".to_string(),
            work_id: "work-31".to_string(),
            lease_id: lease_id.to_string(),
            cancellation_generation: 4,
        }
    }

    fn owner_value(owner: &AgentWorkOwner) -> Value {
        serde_json::to_value(owner).expect("owner should serialize")
    }

    fn no_declaration() -> Value {
        serde_json::json!({})
    }

    fn authorization(overwrite: bool) -> Value {
        serde_json::json!({ "overwrite": overwrite })
    }

    /// Hold both process-global swaps in one order for every test, so the
    /// handle map, the asset register, the saga table, the staging root and
    /// the grant registry are all this test's own.
    fn in_saga_session<T>(grants: Vec<FileGrant>, body: impl FnOnce() -> T) -> T {
        with_handles_for_test(HashMap::new(), || with_grants_for_test(grants, body))
    }

    fn register(path: &Path, mode: &str, owner: &AgentWorkOwner) -> AgentAssetSagaReceipt {
        crate::block_on_test(agent_asset_register_handle(
            path.to_string_lossy().into_owned(),
            mode.to_string(),
            owner_value(owner),
        ))
        .expect("register_handle should answer with a receipt")
    }

    fn handle_for(path: &Path, mode: &str, owner: &AgentWorkOwner) -> String {
        register(path, mode, owner)
            .handle_id
            .expect("a granted path should mint a handle")
    }

    fn import(handle_id: &str, owner: &AgentWorkOwner, declared: Value) -> AgentAssetSagaReceipt {
        crate::block_on_test(agent_asset_import(
            handle_id.to_string(),
            owner_value(owner),
            declared,
        ))
        .expect("import should answer with a receipt")
    }

    fn stage(
        handle_id: &str,
        owner: &AgentWorkOwner,
        expected_sha256: &str,
        data: &[u8],
    ) -> AgentAssetSagaReceipt {
        crate::block_on_test(agent_asset_stage_export(
            handle_id.to_string(),
            owner_value(owner),
            expected_sha256.to_string(),
            data,
        ))
        .expect("stage_export should answer with a receipt")
    }

    fn finalize(saga_id: &str, owner: &AgentWorkOwner, overwrite: bool) -> AgentAssetSagaReceipt {
        crate::block_on_test(agent_asset_finalize_export(
            saga_id.to_string(),
            owner_value(owner),
            authorization(overwrite),
        ))
        .expect("finalize_export should answer with a receipt")
    }

    fn cleanup(saga_id: Option<&str>, owner: &AgentWorkOwner) -> AgentAssetSagaReceipt {
        crate::block_on_test(agent_asset_cleanup(
            saga_id.map(str::to_string),
            owner_value(owner),
        ))
        .expect("cleanup should answer with a receipt")
    }

    fn digest_of(bytes: &[u8]) -> String {
        hex_digest(Sha256::digest(bytes))
    }

    fn write_test_wav(path: &Path, sample_rate: u32) {
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer = hound::WavWriter::create(path, spec).expect("WAV writer should open");
        for sample in 0_i16..64 {
            writer.write_sample(sample).expect("sample should write");
        }
        writer.finalize().expect("WAV should finalize");
    }

    #[test]
    fn agent_asset_saga_register_handle_refuses_an_ungranted_path() {
        let directory = TestDir::create();
        let sample = directory.file("kick.bin", b"kick");
        let owner = owner_named("lease-register");

        let refused = in_saga_session(Vec::new(), || {
            let receipt = register(&sample, "read", &owner);
            assert!(
                read_handles().is_empty(),
                "a refused path must mint no handle"
            );
            receipt
        });

        assert_eq!(refused.state, AgentAssetSagaState::Failed);
        assert_eq!(refused.failure, Some(AgentAssetFailureKind::AccessDenied));
        assert_eq!(refused.handle_id, None);
    }

    #[test]
    fn agent_asset_saga_register_handle_mints_for_a_granted_path() {
        let directory = TestDir::create();
        let sample = directory.file("kick.bin", b"kick");
        let owner = owner_named("lease-register");

        let granted = in_saga_session(vec![directory.grant(GrantMode::Read)], || {
            register(&sample, "read", &owner)
        });

        assert_eq!(granted.state, AgentAssetSagaState::Committed);
        assert_eq!(granted.compensation, AgentAssetCompensation::NotNeeded);
        assert!(granted
            .handle_id
            .expect("a granted path should mint a handle")
            .starts_with(HANDLE_ID_PREFIX));
    }

    #[test]
    fn agent_asset_saga_refuses_a_malformed_handle_id_before_lookup() {
        let owner = owner_named("lease-malformed");

        in_saga_session(Vec::new(), || {
            for malformed in ["/etc/passwd", "asset-handle-nope", ""] {
                let error = crate::block_on_test(agent_asset_import(
                    malformed.to_string(),
                    owner_value(&owner),
                    no_declaration(),
                ))
                .expect_err("a malformed handle id must not reach a lookup");
                assert_eq!(error, "Asset handle id is malformed");
            }

            // A well-formed id naming nothing answers with a receipt, which is
            // what makes the errors above the pre-lookup refusal rather than
            // the ordinary "no such handle" outcome.
            let unknown = import(&new_handle_id(), &owner, no_declaration());
            assert_eq!(unknown.failure, Some(AgentAssetFailureKind::HandleUnknown));
        });
    }

    #[test]
    fn agent_asset_saga_import_registers_the_content_address_and_echoes_the_owner() {
        let directory = TestDir::create();
        let bytes = b"snare-bytes";
        let sample = directory.file("snare.bin", bytes);
        let owner = owner_named("lease-import");

        in_saga_session(vec![directory.grant(GrantMode::Read)], || {
            let handle = handle_for(&sample, "read", &owner);
            let receipt = import(&handle, &owner, no_declaration());

            let expected = digest_of(bytes);
            assert_eq!(receipt.state, AgentAssetSagaState::Committed);
            assert_eq!(receipt.compensation, AgentAssetCompensation::NotNeeded);
            assert_eq!(receipt.content_hash.as_deref(), Some(expected.as_str()));
            assert_eq!(receipt.asset_id, Some(format!("sha256:{expected}")));
            assert_eq!(receipt.owner.run_id, "run-77");
            assert_eq!(receipt.owner.work_id, "work-31");
            assert_eq!(receipt.owner.lease_id, "lease-import");
            assert_eq!(receipt.owner.cancellation_generation, 4);

            let registered = registered_asset(&format!("sha256:{expected}"))
                .expect("a committed import should register its asset id");
            assert_eq!(registered.handle_id, handle);
            assert_eq!(registered.metadata.byte_length, bytes.len() as u64);
        });
    }

    #[test]
    fn agent_asset_saga_import_refuses_a_declared_sample_rate_the_bytes_contradict() {
        let directory = TestDir::create();
        let wav = directory.join("loop.wav");
        write_test_wav(&wav, 44_100);
        let owner = owner_named("lease-declared");

        in_saga_session(vec![directory.grant(GrantMode::Read)], || {
            let handle = handle_for(&wav, "read", &owner);
            let receipt = import(&handle, &owner, serde_json::json!({ "sampleRate": 48_000 }));

            assert_eq!(receipt.state, AgentAssetSagaState::Failed);
            assert_eq!(
                receipt.failure,
                Some(AgentAssetFailureKind::MetadataMismatch)
            );
            assert_eq!(receipt.asset_id, None);
            assert!(
                read_assets().is_empty(),
                "a contradicted declaration must register nothing"
            );

            let metadata = receipt
                .metadata
                .expect("a mismatch receipt should carry what the bytes say");
            assert_eq!(metadata.format.as_deref(), Some("wav"));
            assert_eq!(metadata.sample_rate, Some(44_100));
            assert_eq!(metadata.channels, Some(1));
            assert_eq!(metadata.frame_count, Some(64));
        });
    }

    #[test]
    fn agent_asset_saga_stage_export_refuses_bytes_that_miss_the_expected_digest() {
        let directory = TestDir::create();
        let destination = directory.join("stem.wav");
        let owner = owner_named("lease-stage");

        in_saga_session(vec![directory.grant(GrantMode::ReadWrite)], || {
            let handle = handle_for(&destination, "read-write", &owner);
            let receipt = stage(&handle, &owner, &"0".repeat(64), b"stem-bytes");

            assert_eq!(receipt.state, AgentAssetSagaState::Failed);
            assert_eq!(
                receipt.failure,
                Some(AgentAssetFailureKind::VerificationFailed)
            );
            assert_eq!(receipt.compensation, AgentAssetCompensation::Completed);
            assert!(
                !staged_path_for(&receipt.saga_id).exists(),
                "unverified bytes must not be left staged"
            );
        });
    }

    #[test]
    fn agent_asset_saga_finalize_refuses_an_existing_destination_without_overwrite() {
        let directory = TestDir::create();
        let destination = directory.file("stem.wav", b"original-stem");
        let owner = owner_named("lease-authorize");
        let replacement = b"replacement-stem";

        in_saga_session(vec![directory.grant(GrantMode::ReadWrite)], || {
            let handle = handle_for(&destination, "read-write", &owner);
            let staged = stage(&handle, &owner, &digest_of(replacement), replacement);
            assert_eq!(staged.state, AgentAssetSagaState::ExternalPending);
            assert_eq!(staged.compensation, AgentAssetCompensation::Available);
            let saga_id = staged.saga_id;

            let refused = finalize(&saga_id, &owner, false);
            assert_eq!(refused.state, AgentAssetSagaState::Failed);
            assert_eq!(
                refused.failure,
                Some(AgentAssetFailureKind::AuthorizationRequired)
            );
            assert_eq!(refused.compensation, AgentAssetCompensation::Available);
            assert_eq!(
                fs::read(&destination).expect("destination should still be readable"),
                b"original-stem".to_vec()
            );
            assert!(
                staged_path_for(&saga_id).exists(),
                "an unauthorized finalize must keep the staged bytes"
            );

            let committed = finalize(&saga_id, &owner, true);
            assert_eq!(committed.state, AgentAssetSagaState::Committed);
            assert_eq!(committed.compensation, AgentAssetCompensation::NotNeeded);
            assert_eq!(
                digest_of(&fs::read(&destination).expect("destination should be readable")),
                digest_of(replacement)
            );
            assert_eq!(
                committed.content_hash.as_deref(),
                Some(digest_of(replacement).as_str())
            );
            assert!(
                !staged_path_for(&saga_id).exists(),
                "a committed finalize must drop the staged bytes"
            );
        });
    }

    #[test]
    fn agent_asset_saga_finalize_claims_a_saga_exactly_once() {
        let directory = TestDir::create();
        let destination = directory.join("stem.wav");
        let owner = owner_named("lease-first");
        let payload = b"finalized-stem";

        in_saga_session(vec![directory.grant(GrantMode::ReadWrite)], || {
            let handle = handle_for(&destination, "read-write", &owner);
            let saga_id = stage(&handle, &owner, &digest_of(payload), payload).saga_id;

            assert_eq!(
                finalize(&saga_id, &owner, true).state,
                AgentAssetSagaState::Committed
            );

            let repeated = finalize(&saga_id, &owner, true);
            assert_eq!(repeated.state, AgentAssetSagaState::Refused);
            assert_eq!(repeated.failure, Some(AgentAssetFailureKind::AlreadyOwned));
            assert_eq!(repeated.finalize_owner.as_deref(), Some("lease-first"));
            assert_eq!(
                fs::read(&destination).expect("destination should be readable"),
                payload.to_vec()
            );
        });
    }

    #[test]
    fn agent_asset_saga_finalize_by_another_owner_claims_nothing() {
        let directory = TestDir::create();
        let destination = directory.join("stem.wav");
        let owner = owner_named("lease-owner");
        let stranger = owner_named("lease-stranger");
        let payload = b"owned-stem";

        in_saga_session(vec![directory.grant(GrantMode::ReadWrite)], || {
            let handle = handle_for(&destination, "read-write", &owner);
            let saga_id = stage(&handle, &owner, &digest_of(payload), payload).saga_id;

            let refused = finalize(&saga_id, &stranger, true);
            assert_eq!(refused.state, AgentAssetSagaState::Refused);
            assert_eq!(refused.failure, Some(AgentAssetFailureKind::AccessDenied));
            assert_eq!(refused.finalize_owner, None);
            assert!(
                !destination.exists(),
                "a refused finalize must write nothing"
            );

            // The saga is still finalizable, which is what proves the refusal
            // claimed nothing rather than merely reporting nothing.
            let committed = finalize(&saga_id, &owner, true);
            assert_eq!(committed.state, AgentAssetSagaState::Committed);
            assert_eq!(committed.finalize_owner.as_deref(), Some("lease-owner"));
        });
    }

    #[test]
    fn agent_asset_saga_cleanup_claims_once_and_sweeps_only_orphans() {
        let directory = TestDir::create();
        let owner = owner_named("lease-cleanup");
        let cleaned = b"cleaned-stem";
        let pending = b"pending-stem";

        in_saga_session(vec![directory.grant(GrantMode::ReadWrite)], || {
            let cleaned_handle = handle_for(&directory.join("cleaned.wav"), "read-write", &owner);
            let cleaned_saga = stage(&cleaned_handle, &owner, &digest_of(cleaned), cleaned).saga_id;
            assert!(staged_path_for(&cleaned_saga).exists());

            let claimed = cleanup(Some(&cleaned_saga), &owner);
            assert_eq!(claimed.state, AgentAssetSagaState::Committed);
            assert_eq!(claimed.compensation, AgentAssetCompensation::Completed);
            assert_eq!(claimed.cleanup_owner.as_deref(), Some("lease-cleanup"));
            assert!(!staged_path_for(&cleaned_saga).exists());

            let repeated = cleanup(Some(&cleaned_saga), &owner);
            assert_eq!(repeated.state, AgentAssetSagaState::Refused);
            assert_eq!(repeated.failure, Some(AgentAssetFailureKind::AlreadyOwned));
            assert_eq!(repeated.compensation, AgentAssetCompensation::Completed);
            assert_eq!(repeated.cleanup_owner.as_deref(), Some("lease-cleanup"));

            let pending_handle = handle_for(&directory.join("pending.wav"), "read-write", &owner);
            let pending_saga = stage(&pending_handle, &owner, &digest_of(pending), pending).saga_id;
            let orphan = staged_path_for(&new_saga_id());
            fs::write(&orphan, b"abandoned").expect("orphan should be planted");

            let swept = cleanup(None, &owner);
            assert_eq!(swept.state, AgentAssetSagaState::Committed);
            assert_eq!(
                swept.message.as_deref(),
                Some("Removed 1 orphaned staged asset files")
            );
            assert!(!orphan.exists(), "an orphan tmp file must be swept");
            assert!(
                staged_path_for(&pending_saga).exists(),
                "a live external-pending saga keeps its staged bytes"
            );
        });
    }

    #[test]
    fn agent_asset_saga_answers_a_stale_owner_with_full_receipts() {
        let directory = TestDir::create();
        let owner = AgentWorkOwner {
            run_id: "run-retired".to_string(),
            work_id: "work-retired".to_string(),
            lease_id: "lease-retired".to_string(),
            cancellation_generation: u64::MAX,
        };
        let exported = b"stale-owner-stem";
        let abandoned = b"stale-owner-abandoned";

        in_saga_session(vec![directory.grant(GrantMode::ReadWrite)], || {
            let export_handle = handle_for(&directory.join("export.wav"), "read-write", &owner);
            let staged = stage(&export_handle, &owner, &digest_of(exported), exported);
            assert_eq!(staged.state, AgentAssetSagaState::ExternalPending);
            assert_eq!(staged.owner, owner);

            let committed = finalize(&staged.saga_id, &owner, true);
            assert_eq!(committed.state, AgentAssetSagaState::Committed);
            assert_eq!(committed.owner, owner);

            let abandon_handle = handle_for(&directory.join("abandon.wav"), "read-write", &owner);
            let abandoned_saga =
                stage(&abandon_handle, &owner, &digest_of(abandoned), abandoned).saga_id;
            let swept = cleanup(Some(&abandoned_saga), &owner);
            assert_eq!(swept.state, AgentAssetSagaState::Committed);
            assert_eq!(swept.compensation, AgentAssetCompensation::Completed);
            assert_eq!(swept.owner, owner);
        });
    }
}
