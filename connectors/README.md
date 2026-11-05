# Connectors

A connector tells Tailr Core how to reach a system: a single JSON file (`<id>.json`), or a folder with `connector.json`, `README.md`, `context.md` (guidance for the AI) and optional code functions in `tools/`. Code always runs in Tailr Core's sandbox: no network of its own, no secrets, only the calls listed in the manifest, with the caller's permissions.

`index.json` lists the connectors in this source, with their versions. Tailr Core reads it when an administrator refreshes the source.
