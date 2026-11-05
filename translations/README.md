# Translations

Translations of the Tailr Core admin environment. Tailr Core ships with English built in (the source language); every other language, Dutch too, comes from here, the same way as connectors and plugins. A new installation is in English; the setup screen offers Dutch. An administrator adds a language in *Catalogue → Translations*, Tailr Core downloads it at that moment, and shows an update when a newer version is published here.

## Layout

```
translations/
├── index.json   the list of languages in this source, with their versions
├── nl.json      one file per language
└── de.json
```

`index.json`:

```json
{
  "$schema": "../schemas/translation-index.json",
  "name": "Tailr",
  "translations": [
    { "code": "de", "file": "de.json", "version": "1.0.0", "name": "Deutsch" }
  ]
}
```

- `code`: language code, such as `nl`, `de` or `pt-BR`. Not `en`: that is built into Tailr Core.
- `file`: the translation file, relative to `index.json`.
- `version`: raise it with every change. Tailr Core offers an update when the version here is higher than the installed one.
- `name` (optional): the name in the language menu. The default is `name` in the file itself.

A language file (`de.json`):

```json
{
  "$schema": "../schemas/translation.json",
  "name": "Deutsch",
  "dateLocale": "de-DE",
  "Connections": "Verbindungen",
  "Welcome, {name}": "Willkommen, {name}"
}
```

The keys are the English source texts of the admin environment (and of the emails Tailr Core sends), and the values are the translation. Translate from English; [nl.json](nl.json) is a complete example. Keep placeholders such as `{name}` exactly as they are: a file with a missing or extra placeholder is refused.

## Add a language

1. In Tailr Core, open *Catalogue → Translations*, choose the language and download the missing texts. You get a file with only the texts that still need a translation.
2. Translate it, yourself or with your own AI. The screen shows a prompt you can copy.
3. Check it: `npx tailr check translations/de.json`, and in tailr-core `node scripts/i18n-check.mjs path/to/de.json` to see what is still missing.
4. Add the file and a line in `index.json`, and open a pull request (see [CONTRIBUTING.md](../CONTRIBUTING.md)).

## Updating a language

When Tailr Core gets new texts, download the missing texts again (or run `i18n-check`), translate them, add them to the file and raise `version` in `index.json`. Administrators then see *Update available*.
