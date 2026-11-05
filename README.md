# Tailr catalog

The official catalog of **connectors**, **plugins** and **translations** for [Tailr Core](https://tailr.nl): the open-source gateway that gives an organisation central, controlled access to AI on top of its own business systems.

Tailr Core uses this repository as its default source. Nothing from it is installed automatically: an administrator chooses what to add, in *Catalogue → Connectors* or *Catalogue → Plugins*. You can also add it, a fork, or your own repository with the same layout as a source for your own installation.

## Layout

```
connectors/     Connectors: how Tailr Core reaches a system (REST, GraphQL, SOAP, MCP, databases).
                index.json lists them. Code in a connector always runs in Tailr Core's sandbox.
plugins/        Plugins: new capabilities in Tailr Core itself (trusted code, no sandbox).
                One folder per plugin; recommended.json lists the ones the setup wizard suggests.
translations/   Translations of the admin environment, one file per language.
schemas/        JSON schemas for connector.json, plugin.json and translation files.
```

| Connector | What |
| --- | --- |
| [Exact Online](connectors/exact-online) | General ledger, entries, matching status, bank lines (OAuth2, code functions) |
| [GitHub](connectors/github.json) | Repositories, files, issues and pull requests |
| [Google Analytics 4](connectors/google-analytics.json) | Reports from the Data API (OAuth2) |
| [Google Search Console](connectors/google-search-console.json) | Search performance per site (OAuth2) |
| [Matomo](connectors/matomo.json) | Website statistics, read only |
| [WooCommerce](connectors/woocommerce.json) | Orders, products and customers (REST API v3) |

| Plugin | What |
| --- | --- |
| [ai-clients](plugins/ai-clients) | Decide which AI tools and apps (OAuth clients) may connect |
| [dashboards](plugins/dashboards) | Let employees have their AI build dashboards that run sandboxed, with their own permissions |
| [extra-logging](plugins/extra-logging) | Send every call and admin change to a file, a webhook or syslog |
| [handleiding](plugins/handleiding) | A guide for everyone, with example questions per connection; the admin edits it in markdown |
| [koppelingen-goedkeuren](plugins/koppelingen-goedkeuren) | Connections and sources created through the AI wait for an admin's approval |
| [mededeling](plugins/mededeling) | An announcement at the top of every page, for everyone or certain roles |

Most texts for users are in Dutch, with English translations where the screens need them.

## Make your own

- Start from an existing connector or plugin, and keep the `"$schema"` line: your editor then completes and checks `connector.json` and `plugin.json`.
- Check before you open a pull request or upload: `npx tailr check <folder>`. It runs the same check Tailr Core runs when installing (schema, references, placeholders, plugin API version).
- Mark personal data in a connector (`privacy`, `sensitivity`, `audience`). The connector sets the minimum protection; an administrator can only make it stricter.

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for third-party material. "Tailr" is a trademark; the license does not grant rights to the name.
