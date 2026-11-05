# Plugins

Plugins add capabilities to Tailr Core itself. They are trusted code without a sandbox, so only an administrator installs them (*Catalogue → Plugins*); the AI never can, and a new installation has none enabled. Each plugin is a folder with `plugin.json`, `index.ts` and optional screens in `web/`. Plugins only use the plugin API (`@tailr/plugin`).

`recommended.json` lists the plugins the setup wizard suggests (step *Recommended plugins*).


