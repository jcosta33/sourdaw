#![cfg(windows)]

use std::sync::atomic::{AtomicPtr, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use windows::Foundation::TypedEventHandler;
use windows::Win32::Foundation::{E_ABORT, E_ACCESSDENIED, E_POINTER, S_FALSE, S_OK};
use windows::Win32::Media::Audio::{
    IActivateAudioInterfaceAsyncOperation, IActivateAudioInterfaceAsyncOperation_Impl,
    IActivateAudioInterfaceCompletionHandler, IActivateAudioInterfaceCompletionHandler_Impl,
};
use windows_core::{
    implement, ComObject, IUnknown, Interface, OutRef, Ref, Result, HRESULT, HSTRING,
};

#[derive(Default)]
struct DropProbe(Arc<AtomicUsize>);

impl Drop for DropProbe {
    fn drop(&mut self) {
        self.0.fetch_add(1, Ordering::SeqCst);
    }
}

#[implement(IActivateAudioInterfaceAsyncOperation)]
struct Operation {
    activation: HRESULT,
    method: HRESULT,
    output: Option<IUnknown>,
    calls: Arc<AtomicUsize>,
    _drop: DropProbe,
}

impl IActivateAudioInterfaceAsyncOperation_Impl for Operation_Impl {
    fn GetActivateResult(&self, activation: *mut HRESULT, output: OutRef<IUnknown>) -> Result<()> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.method.ok()?;
        if activation.is_null() {
            return Err(E_POINTER.into());
        }
        // The fixture's projected callers supply a live, writable HRESULT slot.
        // This is the COM method's pointer contract; no representation conversion occurs here.
        unsafe { *activation = self.activation };
        output.write(self.output.clone())
    }
}

fn operation(
    activation: HRESULT,
    method: HRESULT,
    output: Option<IUnknown>,
    drops: Arc<AtomicUsize>,
    calls: Arc<AtomicUsize>,
) -> IActivateAudioInterfaceAsyncOperation {
    ComObject::new(Operation {
        activation,
        method,
        output,
        calls,
        _drop: DropProbe(drops),
    })
    .into_interface()
}

fn empty_operation(drops: Arc<AtomicUsize>) -> IActivateAudioInterfaceAsyncOperation {
    operation(S_OK, S_OK, None, drops, Arc::default())
}

#[implement(IActivateAudioInterfaceCompletionHandler)]
struct Completion {
    observed: Arc<AtomicPtr<core::ffi::c_void>>,
    calls: Arc<AtomicUsize>,
    _drop: DropProbe,
}

impl IActivateAudioInterfaceCompletionHandler_Impl for Completion_Impl {
    fn ActivateCompleted(
        &self,
        operation: Ref<IActivateAudioInterfaceAsyncOperation>,
    ) -> Result<()> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.observed
            .store(operation.ok()?.as_raw(), Ordering::SeqCst);
        Ok(())
    }
}

#[test]
fn callback_borrows_exact_operation_without_retaining_it() {
    let operation_drops = Arc::default();
    let operation = empty_operation(Arc::clone(&operation_drops));
    let observed = Arc::new(AtomicPtr::default());
    let calls = Arc::default();
    let handler_drops = Arc::default();
    let handler: IActivateAudioInterfaceCompletionHandler = ComObject::new(Completion {
        observed: Arc::clone(&observed),
        calls: Arc::clone(&calls),
        _drop: DropProbe(Arc::clone(&handler_drops)),
    })
    .into_interface();

    // Both interfaces came from genuine #[implement] allocations and remain alive for the call.
    unsafe { handler.ActivateCompleted(&operation) }.unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(observed.load(Ordering::SeqCst), operation.as_raw());
    assert_eq!(operation_drops.load(Ordering::SeqCst), 0);

    let owned_clone = operation.clone();
    drop(operation);
    assert_eq!(operation_drops.load(Ordering::SeqCst), 0);
    drop(owned_clone);
    assert_eq!(operation_drops.load(Ordering::SeqCst), 1);
    assert_eq!(handler_drops.load(Ordering::SeqCst), 0);
    drop(handler);
    assert_eq!(handler_drops.load(Ordering::SeqCst), 1);
}

#[test]
fn callback_null_operation_returns_e_pointer_through_generated_vtable() {
    let calls = Arc::default();
    let observed = Arc::new(AtomicPtr::default());
    let handler: IActivateAudioInterfaceCompletionHandler = ComObject::new(Completion {
        observed: Arc::clone(&observed),
        calls: Arc::clone(&calls),
        _drop: DropProbe::default(),
    })
    .into_interface();

    // The projected Param<Option<&Interface>> explicitly represents a nullable COM input.
    let error =
        unsafe { handler.ActivateCompleted(None::<&IActivateAudioInterfaceAsyncOperation>) }
            .unwrap_err();
    assert_eq!(error.code(), E_POINTER);
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert!(observed.load(Ordering::SeqCst).is_null());
}

#[test]
fn outref_returns_exact_unknown_with_independent_owned_lifetime() {
    let payload_drops = Arc::default();
    let payload: IUnknown = empty_operation(Arc::clone(&payload_drops)).into();
    let identity = payload.as_raw();
    let operation_drops = Arc::default();
    let calls = Arc::default();
    let operation = operation(
        S_FALSE,
        S_OK,
        Some(payload),
        Arc::clone(&operation_drops),
        Arc::clone(&calls),
    );
    let mut activation = E_ABORT;
    let mut output = None;

    // HRESULT and Option<IUnknown> are actual initialized ABI output slots and outlive the call.
    unsafe { operation.GetActivateResult(&mut activation, &mut output) }.unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(activation, S_FALSE);
    assert_eq!(output.as_ref().unwrap().as_raw(), identity);
    drop(operation);
    assert_eq!(operation_drops.load(Ordering::SeqCst), 1);
    assert_eq!(payload_drops.load(Ordering::SeqCst), 0);
    let owned_clone = output.as_ref().unwrap().clone();
    drop(output);
    assert_eq!(payload_drops.load(Ordering::SeqCst), 0);
    drop(owned_clone);
    assert_eq!(payload_drops.load(Ordering::SeqCst), 1);
}

#[test]
fn outref_preserves_failed_activation_hresult_separately_from_method_success() {
    let calls = Arc::default();
    let operation = operation(
        E_ACCESSDENIED,
        S_OK,
        None,
        Arc::default(),
        Arc::clone(&calls),
    );
    let mut activation = S_FALSE;
    let mut output = None;
    // Both out parameters point to initialized, writable slots for the whole call.
    unsafe { operation.GetActivateResult(&mut activation, &mut output) }.unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(activation, E_ACCESSDENIED);
    assert!(output.is_none());
}

#[test]
fn outref_propagates_method_failure_without_replacing_output_slots() {
    let calls = Arc::default();
    let operation = operation(S_OK, E_ABORT, None, Arc::default(), Arc::clone(&calls));
    let mut activation = S_FALSE;
    let mut output = None;
    // The implementation returns before writing either valid output slot on method failure.
    let error = unsafe { operation.GetActivateResult(&mut activation, &mut output) }.unwrap_err();
    assert_eq!(error.code(), E_ABORT);
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(activation, S_FALSE);
    assert!(output.is_none());
}

#[test]
fn outref_null_slot_returns_e_pointer_without_leaking_the_output_clone() {
    let payload_drops = Arc::default();
    let payload: IUnknown = empty_operation(Arc::clone(&payload_drops)).into();
    let calls = Arc::default();
    let operation = operation(
        S_OK,
        S_OK,
        Some(payload),
        Arc::default(),
        Arc::clone(&calls),
    );
    let mut activation = E_ABORT;
    // The live HRESULT slot is valid. The implementation delegates the intentionally null
    // interface slot to the real OutRef::write null check before any interface-pointer write.
    let error =
        unsafe { operation.GetActivateResult(&mut activation, core::ptr::null_mut()) }.unwrap_err();
    assert_eq!(error.code(), E_POINTER);
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(activation, S_OK);
    assert_eq!(payload_drops.load(Ordering::SeqCst), 0);
    drop(operation);
    assert_eq!(payload_drops.load(Ordering::SeqCst), 1);
}

#[test]
fn scalar_delegate_receives_copy_type_values_through_generated_invoke() {
    let observed = Arc::new(Mutex::new(Vec::new()));
    let callback_observed = Arc::clone(&observed);
    let callback = TypedEventHandler::<i32, u64>::new(move |sender: i32, value: u64| {
        callback_observed.lock().unwrap().push((sender, value));
        Ok(())
    });
    callback.Invoke(-37, 0xfedc_ba98_7654_3210_u64).unwrap();
    callback.Invoke(91, 7_u64).unwrap();
    assert_eq!(
        *observed.lock().unwrap(),
        [(-37, 0xfedc_ba98_7654_3210), (91, 7)],
    );
}

#[test]
fn hstring_delegate_borrows_clone_type_and_can_retain_an_owned_clone() {
    let observed = Arc::new(Mutex::new(Vec::new()));
    let callback_observed = Arc::clone(&observed);
    let callback =
        TypedEventHandler::<i32, HSTRING>::new(move |sender: i32, value: Ref<HSTRING>| {
            callback_observed
                .lock()
                .unwrap()
                .push((sender, value.ok()?.clone()));
            Ok(())
        });
    let text = HSTRING::from("left\0right \u{1d11e}");
    callback.Invoke(-13, &text).unwrap();
    drop(text);
    callback.Invoke(29, &HSTRING::new()).unwrap();
    drop(callback);
    let values = observed.lock().unwrap();
    assert_eq!(values.len(), 2);
    assert_eq!(values[0].0, -13);
    let expected: Vec<u16> = "left\0right \u{1d11e}".encode_utf16().collect();
    assert_eq!(&*values[0].1, expected.as_slice());
    assert_eq!(values[1].0, 29);
    assert!(values[1].1.is_empty());
}
