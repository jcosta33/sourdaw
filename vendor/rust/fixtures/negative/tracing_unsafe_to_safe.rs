#[tracing::instrument]
unsafe fn original() {}
fn main() { let _: fn() = original; }
