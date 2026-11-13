use std::future::Future;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll, Waker};

use tracing::field::{Field, Visit};
use tracing::span::{Attributes, Id};
use tracing::{Event, Subscriber};
use tracing_subscriber::layer::{Context as LayerContext, SubscriberExt};
use tracing_subscriber::Layer;

#[derive(Default)]
struct Observed {
    spans: Vec<(String, Vec<(String, String)>)>,
    events: Vec<Vec<(String, String)>>,
    enters: usize,
}

#[derive(Clone)]
struct Capture(Arc<Mutex<Observed>>);

#[derive(Default)]
struct Values(Vec<(String, String)>);
impl Visit for Values {
    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        self.0.push((field.name().to_owned(), format!("{value:?}")));
    }
}

impl<S: Subscriber> Layer<S> for Capture {
    fn on_new_span(&self, attributes: &Attributes<'_>, _: &Id, _: LayerContext<'_, S>) {
        let mut values = Values::default();
        attributes.record(&mut values);
        self.0
            .lock()
            .expect("capture lock")
            .spans
            .push((attributes.metadata().name().to_owned(), values.0));
    }

    fn on_enter(&self, _: &Id, _: LayerContext<'_, S>) {
        self.0.lock().expect("capture lock").enters += 1;
    }

    fn on_event(&self, event: &Event<'_>, _: LayerContext<'_, S>) {
        let mut values = Values::default();
        event.record(&mut values);
        self.0.lock().expect("capture lock").events.push(values.0);
    }
}

#[tracing::instrument(skip(secret), ret)]
unsafe fn instrumented_sync(number: i32, secret: &str) -> i32 {
    let _ = secret;
    number + 5
}

#[tracing::instrument(skip_all, ret)]
async fn instrumented_async(number: i32) -> i32 {
    number * 2 + 1
}

#[tracing::instrument(skip_all)]
fn instrumented_guarded_future(value: Option<i32>) -> impl Future<Output = i32> {
    async move {
        match value {
            Some(number) if number > 3 => number * 2,
            Some(_) => -1,
            None => -2,
        }
    }
}

#[test]
fn sync_expansion_preserves_safety_fields_skip_and_return_event() {
    let observed = Arc::new(Mutex::new(Observed::default()));
    let subscriber = tracing_subscriber::registry().with(Capture(Arc::clone(&observed)));
    tracing::subscriber::with_default(subscriber, || {
        let function: unsafe fn(i32, &str) -> i32 = instrumented_sync;
        // The fixture function has no unsafe preconditions beyond its ordinary inputs.
        assert_eq!(unsafe { function(7, "private-fixture") }, 12);
    });
    let observed = observed.lock().expect("capture lock");
    assert_eq!(observed.spans.len(), 1);
    assert_eq!(observed.spans[0].0, "instrumented_sync");
    assert!(observed.spans[0]
        .1
        .contains(&("number".to_owned(), "7".to_owned())));
    assert!(!observed.spans[0]
        .1
        .iter()
        .any(|(field, _)| field == "secret"));
    assert!(observed
        .events
        .iter()
        .any(|values| values.contains(&("return".to_owned(), "12".to_owned()))));
    assert!(observed.enters > 0);
}

#[test]
fn async_expansion_records_the_polled_body_and_return_value() {
    let observed = Arc::new(Mutex::new(Observed::default()));
    let subscriber = tracing_subscriber::registry().with(Capture(Arc::clone(&observed)));
    tracing::subscriber::with_default(subscriber, || {
        let future = instrumented_async(9);
        assert!(observed.lock().expect("capture lock").spans.is_empty());
        let mut future = std::pin::pin!(future);
        let mut context = Context::from_waker(Waker::noop());
        assert_eq!(future.as_mut().poll(&mut context), Poll::Ready(19));
    });
    let observed = observed.lock().expect("capture lock");
    assert_eq!(observed.spans.len(), 1);
    assert_eq!(observed.spans[0].0, "instrumented_async");
    assert!(observed
        .events
        .iter()
        .any(|values| values.contains(&("return".to_owned(), "19".to_owned()))));
    assert!(observed.enters > 0);
}

#[test]
fn parsed_async_block_preserves_match_guard_semantics() {
    let observed = Arc::new(Mutex::new(Observed::default()));
    let subscriber = tracing_subscriber::registry().with(Capture(Arc::clone(&observed)));
    tracing::subscriber::with_default(subscriber, || {
        let mut context = Context::from_waker(Waker::noop());
        let mut accepted = std::pin::pin!(instrumented_guarded_future(Some(7)));
        assert_eq!(accepted.as_mut().poll(&mut context), Poll::Ready(14));
        let mut refused = std::pin::pin!(instrumented_guarded_future(Some(2)));
        assert_eq!(refused.as_mut().poll(&mut context), Poll::Ready(-1));
    });
    let observed = observed.lock().expect("capture lock");
    assert_eq!(observed.spans.len(), 2);
    assert!(observed
        .spans
        .iter()
        .all(|(name, _)| name == "instrumented_guarded_future"));
    assert!(observed.enters > 0);
}
