#[tracing::instrument(skip(missing))]
fn original(actual: i32) -> i32 { actual }
fn main() {}
