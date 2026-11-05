# Contributing

Thanks for helping. Connectors, plugins and translations are all welcome.

1. **Fork** this repository and make your change in `connectors/`, `plugins/` or `translations/`.
2. **Keep the `"$schema"` line** at the top of `connector.json` or `plugin.json`, so your editor checks it.
3. **Check it:** `npx tailr check <folder or file>`. It must pass.
4. **Test it** in your own Tailr Core: add your fork as a source (*Catalogue → Connectors → Add → From Git*, or a plugin source in the Danger zone), install it and try it.
5. **Bump the version** of what you changed, and the version in `connectors/index.json` for a connector.
6. **Open a pull request** with what it does, how you tested it, and which systems or versions it supports.

**Rules**
- **No secrets:** no tokens, passwords or customer data, also not in examples or tests.
- **Personal data is marked** in a connector with `privacy`, `sensitivity` and `audience`. Use the standard pattern (see below).

**Personal data: the standard pattern**

For a list without a search field that would return people (customers, orders with names, mandates):
1. **The list has no personal data.** Leave out names, email, phone, address and account numbers with `transform` (`select` or `exclude`). Keep what is not traceable to a person: id, number, status, amounts, dates, country.
2. **Looking up a person goes one at a time,** in a separate function with `privacy`: a required `lookup` (id, number or email), `sensitivity` per field, and a low `maxRecords`. The AI gets pseudonyms.
3. **An overview with names is only for the API,** and only where it is useful (a dashboard, a tool): a separate function with `audience: "api"`. The AI does not see it.

Functions that write keep their level (`write` or `admin`). `tailr check` must pass without `personal_data_unmarked` warnings. Examples: `list_orders`, `list_customers` and `list_orders_with_names` in [woocommerce.json](connectors/woocommerce.json), and [Mollie](connectors/mollie/README.md#persoonsgegevens).
- **Plugins are trusted code** that runs without a sandbox: they are reviewed closely, and must only use the plugin API (`@tailr/plugin`).
- **Texts copied from someone else's documentation or API specification** must have a license that allows it. Mention the source in `NOTICE`.
- **By contributing**, you agree that your contribution is licensed under the Apache License 2.0.
