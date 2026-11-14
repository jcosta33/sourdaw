#[derive(num_enum::TryFromPrimitive)]
#[repr(u8)]
enum Invalid { #[num_enum(alternatives = [9])] First = 1, #[num_enum(alternatives = [9])] Second = 2 }
fn main() {}
