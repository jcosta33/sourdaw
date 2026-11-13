#[visibility::make(pub)]
unsafe fn original() {}
fn main() { let _: fn() = original; }
