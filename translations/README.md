# Translations

Translations of the Tailr Core admin environment. Tailr Core ships with Dutch and English built in; every other language comes from here, the same way as connectors and plugins. An administrator adds a language in *Catalogue → Translations*, Tailr Core downloads it at that moment, and shows an update when a newer version is published here.

## Layout

```
translations/
├── index.json   the list of languages in this source, with their versions
├── de.json      one file per language
└── fr.json
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

- `code`: language code, such as `de`, `fr` or `pt-BR`.
- `file`: the translation file, relative to `index.json`.
- `version`: raise it with every change. Tailr Core offers an update when the version here is higher than the installed one.
- `name` (optional): the name in the language menu. The default is `name` in the file itself.

A language file (`de.json`):

```json
{
  "$schema": "../schemas/translation.json",
  "name": "Deutsch",
  "Koppelingen": "Verbindungen",
  "Welkom, {name}": "Willkommen, {name}"
}
```

The keys are the source texts of the admin environment, and the values are the translation. Keep placeholders such as `{name}` exactly as they are: a file with a missing or extra placeholder is refused.

## Add a language

1. In Tailr Core, open *Catalogue → Translations*, choose the language and download the missing texts. You get a file with only the texts that still need a translation.
2. Translate it, yourself or with your own AI. The screen shows a prompt you can copy.
3. Check it: `npx tailr check translations/de.json`.
4. Add the file and a line in `index.json`, and open a pull request (see [CONTRIBUTING.md](../CONTRIBUTING.md)).
