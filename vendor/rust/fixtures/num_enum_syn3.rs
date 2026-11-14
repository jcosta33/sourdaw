use num_enum::{FromPrimitive, IntoPrimitive, TryFromPrimitive};

#[derive(Debug, PartialEq, Eq, TryFromPrimitive, IntoPrimitive)]
#[repr(i16)]
enum Signed {
    Negative = -7,
    Implicit,
    Explicit = 19,
    #[num_enum(alternatives = [22, 24..=26])]
    Alternative = 27,
}

#[derive(Debug, PartialEq, Eq, FromPrimitive, IntoPrimitive)]
#[repr(u8)]
enum WithDefault {
    Known = 3,
    #[num_enum(default)]
    Other = 255,
}

#[test]
fn signed_implicit_and_explicit_discriminants_preserve_values() {
    assert_eq!(Signed::try_from(-7), Ok(Signed::Negative));
    assert_eq!(Signed::try_from(-6), Ok(Signed::Implicit));
    assert_eq!(Signed::try_from(19), Ok(Signed::Explicit));
    assert_eq!(i16::from(Signed::Implicit), -6);
}

#[test]
fn alternatives_preserve_closed_bounds_and_reject_the_gap() {
    for value in [22, 24, 25, 26, 27] {
        assert_eq!(Signed::try_from(value), Ok(Signed::Alternative));
    }
    assert!(Signed::try_from(23).is_err());
    assert!(Signed::try_from(28).is_err());
}

#[test]
fn default_and_into_primitive_keep_the_declared_discriminants() {
    assert_eq!(WithDefault::from(3), WithDefault::Known);
    assert_eq!(WithDefault::from(72), WithDefault::Other);
    assert_eq!(u8::from(WithDefault::Other), 255);
}
