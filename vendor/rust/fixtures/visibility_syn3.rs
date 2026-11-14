mod visible {
    #[visibility::make(pub)]
    fn transformed(value: i32) -> i32 {
        value * 3 + 1
    }

    #[visibility::make(pub(crate))]
    struct Container {
        pub value: i32,
    }

    #[visibility::make(pub)]
    unsafe fn unsafe_identity(value: i32) -> i32 {
        value
    }
}

#[test]
fn changed_visibility_exposes_the_original_function_and_fields() {
    assert_eq!(visible::transformed(7), 22);
    assert_eq!(visible::Container { value: 13 }.value, 13);
}

#[test]
fn unsafe_function_still_has_an_unsafe_signature() {
    let function: unsafe fn(i32) -> i32 = visible::unsafe_identity;
    // The fixture's identity function has no preconditions beyond its integer input.
    assert_eq!(unsafe { function(19) }, 19);
}
