#[test_log::test]
fn root_port_latest_terminal_table_and_logging_macro_keep_output() {
    use prettytable::{Cell, Row, Table};
    let mut table = Table::new();
    table.add_row(Row::new(vec![Cell::new("μ"), Cell::new("界")]));
    table.add_row(Row::new(vec![Cell::new("ab"), Cell::new("e\u{301}")]));
    let mut bytes = Vec::new();
    table.print(&mut bytes).unwrap();
    let actual = String::from_utf8(bytes).unwrap();
    assert_eq!(
        actual,
        "+----+----+\n| μ  | 界 |\n+----+----+\n| ab | e\u{301}  |\n+----+----+\n"
    );
}

#[test]
fn root_port_logging_macro_rejects_unsupported_function_modifier() {
    let mut function: syn::ItemFn =
        syn::parse2(quote::quote! { fn subject() { assert_eq!(2 + 3, 5); } }).unwrap();
    function.modifiers.defaultness = Some(Default::default());
    let error = test_log_core::try_test(quote::quote! {}, function).unwrap_err();
    assert_eq!(error.to_string(), "unexpected function modifier");
}
