# flowplan-translate

A small, self-hosted web tool to translate [Flowplan](https://github.com/yannicschuller/flowplan) in the browser. Community members sign in with GitHub and suggest translations; reviewers accept them and turn the accepted ones into **one pull request per repository**. It replaces Weblate for Flowplan and is deliberately small: no translation memory, no comment threads, no real-time collaboration, no statistics, no e-mail, no AI suggestions.

Interface in German and English. Languages translated in version 1: **French (fr)** and **Simplified Chinese (zh)**; the source language is English, German is shown as a reference.

## How it works

### components.json

[`components.json`](components.json) lists every catalogue the tool translates – a *component* is one catalogue in one repository:

| Field | Meaning |
| --- | --- |
| `id`, `title` | Identifier (URL) and display name. |
| `repo`, `branch` | GitHub repository (`owner/name`) and its main branch (default `main`). |
| `format` | `flat-json`, `nested-json` or `txt-files` (see below). |
| `source`, `reference`, `targets` | Source language (`en`), German reference (`de`, optional file), target languages (`fr`, `zh`). |
| `files` | JSON formats: language → file path. `txt-files`: groups of `{ key, path, locales, fields }`, where `{field}` and `{locale}` are filled in (e.g. `zh` → `zh-Hans` in the App Store, `zh-CN` on Google Play). |
| `context` | Optional `{ "key": "comment" }` file with notes for translators. |
| `placeholders` | Placeholder styles to check: `index` (`{0}`), `brace` (`{0}`, `{name}`), `printf` (`%@ %d %s %1$s %2$@`), `dollar` (`${applicationName}`). |
| `limits` | Per key: `chars` (code points), `bytes` (UTF-8), `keywords` (App Store keyword rules), `multiline`. Counted like flowplan-app's `test/store.test.ts`: on the trimmed text. |

The file is read on every start and upserted into the database; a component removed from the file is hidden. The tool only translates the languages configured there (there is no "add language" button).

Formats:

- **flat-json** – `{ "key": "text" }`. In flowplan's web app the keys are the English text, optionally with a `||context` suffix (`"Open||status"`); `""` means not translated.
- **nested-json** – objects of objects; the key is the dotted path (`ios.NSCameraUsageDescription`).
- **txt-files** – one plain-text file per field (store listings); trailing newline and line endings are kept.

The writers are format-preserving: a small JSON tokenizer records where each value sits in the original text, and only the values of changed keys are replaced (escaped like `JSON.stringify`, non-ASCII as is). Order, indentation, escapes, line endings and the trailing newline stay as they were – a pull request changes exactly the lines of the changed texts. The tool **never writes the source or reference files and never adds or removes keys**; a key missing in a target file is skipped and listed in the pull request (the repository's own catalogue script, e.g. `npm run i18n` in flowplan, adds keys).

### Roles

- **Translator** – every signed-in GitHub user: suggests translations, and can say "still correct" for an outdated one (as a suggestion).
- **Reviewer** – the logins in `TRANSLATE_REVIEWERS` (case-insensitive), and always `yannicschuller`: a reviewer's own save is accepted at once; reviewers accept or reject suggestions, maintain the glossary, sync and create pull requests.

Reading (overview, lists, editor, glossary) needs no account.

### Checks

On every save (in the browser while typing, and again on the server):

- **Blocking**: the same placeholders as the source (as a multiset, order may change), not empty, length limits, single-line fields without line breaks, no control characters, txt fields without leading/trailing blanks or extra lines, App Store keywords (comma-separated, no spaces around commas, no repeats), at most 10,000 characters.
- **Hints** (saving allowed): leading/trailing whitespace differs from the source, final punctuation differs (full-width and French forms count as the same), a glossary term in the source whose glossary translation is not used.

In the editor, placeholders in the English source and the German reference appear as chips. Below the field there is one button per placeholder of the source: it inserts the placeholder at the caret and shows whether the translation already uses it as often as the source does. A live preview fills in sample values, which you can edit in the browser (they are never saved), for both the translation and the source.

Translations are always shown as text, never as HTML.

### Originals

English (the source) and German (the reference) are shown read-only as "Original" languages: on the overview per component, and as lists to browse and search. An entry shows key, English, German, context and glossary terms. A text without German in the reference file (`""`) is marked "only in the code". The tool never writes either language, and saving English or German is refused (400).

### Outdated

Every translation stores the hash of the source text it was based on (`based_on_hash`). When a sync brings a changed source text, the translation is **outdated** until someone changes it or confirms it with **"still correct"**: a reviewer's confirmation updates the hash at once; a translator's is a suggestion with the same text, for a reviewer to accept. Translations that are already in the repository files at the first sync count as accepted, based on the current source.

### Sync

- **Webhook**: GitHub sends `push` events to `<TRANSLATE_URL>/api/github/webhook`. The `X-Hub-Signature-256` HMAC is checked with `TRANSLATE_WEBHOOK_SECRET` (constant-time); other events, other repositories and other branches are ignored. The answer comes at once (202) and the sync runs in the background, one at a time per repository.
- **"Sync now"** on the overview, for reviewers.

A sync reads the catalogues of the repository's main branch through the contents API (with the App's installation token) and stores the commit per repository. New source texts appear, removed ones are hidden (never deleted, their translations stay), changed ones make their translations outdated. Target-language values are re-imported: a value someone edited in the repository directly wins and becomes the accepted one – unless the tool holds a newer accepted value that is not in the repository yet; then the tool's value is kept and a note says so. A file that does not exist (yet) is reported per component on the overview (to reviewers) instead of failing the sync.

### Pull requests

"Create pull request" (per repository, reviewers) collects every accepted translation that differs from main, fetches the catalogue files **fresh from main**, rewrites them format-preservingly and commits only the changed files through the Git Data API (blobs, tree, commit, ref) on a branch `translate/<yyyy-mm-dd>-<shortid>`. The pull request against main lists the languages with counts, the changed texts (collapsed) and the contributors; the commit message carries `Co-authored-by: login <id+login@users.noreply.github.com>` for every author. The translations are marked `exported` with the pull request number.

While the tool's pull request for a repository is open (tracked in the database and checked through the API), the next export pushes a new commit to its branch (a merge of main when main moved) and updates the description instead of opening a second one. Once main contains the values (after merging), the next sync marks them simply accepted. A pull request closed without merging is forgotten; its translations go into the next one.

### Glossary

Per language: term → translation, with a note, plus one note per language (French: "vous" everywhere). Seeded on the first start with Flowplan's core terms as the existing catalogues render them (Workspace → Espace de travail / 工作区, Database → Base de données / 数据库, Journal → Journal / 日记, …). The editor shows the terms found in a text.

### Badges

Coverage badges for READMEs, rendered as SVG by the tool itself (no external service, no web fonts):

| URL | Coverage of |
| --- | --- |
| `<TRANSLATE_URL>/api/badge?repo=flowplan&lang=fr` | all components of a repository (its name, or `owner/name`) |
| `<TRANSLATE_URL>/api/badge?component=flowplan-web&lang=zh` | one component |
| `<TRANSLATE_URL>/api/badge?lang=fr` | everything |

- `lang` is required (`fr` or `zh`); without it the answer is 400. An unknown language, repository or component gives a grey "unknown" badge with status 404.
- Coverage = current translations that are not outdated ÷ texts (not removed), as on the overview, from the state of the last sync. The message is the floored percentage ("97 %"), coloured like flowplan's README table: 100 % `#2ea44f`, from 90 % `#a3c51c`, from 50 % `#dfb317`, below `#e05d44`.
- The label is the language's own name (Français, 简体中文); `&label=…` replaces it.
- `&format=json` returns the [shields.io endpoint](https://shields.io/badges/endpoint-badge) format `{"schemaVersion":1,"label":…,"message":…,"color":…}` with `Access-Control-Allow-Origin: *`.
- Cached for 10 minutes (`Cache-Control: public, max-age=600`). The endpoint never reads or sets cookies.

The overview has a "Badge for your README" disclosure per repository with the Markdown for each language, e.g.:

```md
[![Français](https://translate.flowplan.org/api/badge?repo=flowplan&lang=fr)](https://translate.flowplan.org/c/flowplan-web/fr)
```

## Privacy and security

- No tracking, no analytics, no external fonts, scripts or CDNs.
- Cookies: the session (`ft_session`, httpOnly, SameSite=Lax, Secure under https, 30 days; the database stores only its SHA-256; signing out deletes it); during sign-in a ten-minute `ft_oauth` cookie for the OAuth `state`; the language cookie `ft_lang` only after the visitor switches the language. Without a switch the language comes from `Accept-Language` (default English).
- Sign-in reads `GET /user` once with the user's OAuth token; the token is not stored. Stored per user: GitHub id, login and name.
- IP addresses are never stored: the only per-address rate limit (sign-in) uses a daily rotating HMAC of the address. Saving suggestions (120 per minute, 2,000 per day), reviewing, syncing and pull requests (10 per 10 minutes) are limited per user; over the limit the API answers 429 with a readable message. Request bodies are size-limited.
- CSRF: every writing request must carry an `Origin` (or, without it, a `Referer`) equal to the origin of `TRANSLATE_URL`, else 403; plus SameSite=Lax. The webhook is checked by its signature instead.
- A strict Content Security Policy (`proxy.ts`): scripts only with the per-request nonce (`strict-dynamic`), styles only from the stylesheet or with the nonce, no inline scripts or style attributes, no framing.
- `X-Forwarded-*` headers are not trusted for any security decision. `X-Forwarded-For` only feeds the hashed sign-in rate-limit key; links, redirects and the Origin check use `TRANSLATE_URL`.

## Environment variables

| Variable | Required | Meaning |
| --- | --- | --- |
| `TRANSLATE_URL` | yes | The public base URL, e.g. `https://translate.flowplan.org` (https in production: Secure cookies, OAuth callback, Origin check). |
| `TRANSLATE_DATA_DIR` | – | Directory for the SQLite database and the generated key (default `./data`; `/app/data` in the image). |
| `TRANSLATE_REVIEWERS` | – | Further reviewers: GitHub logins, comma-separated, case-insensitive. `yannicschuller` always is one. |
| `TRANSLATE_GITHUB_APP_ID` | yes | The GitHub App's id (installation tokens). |
| `TRANSLATE_GITHUB_CLIENT_ID` | yes | The App's client id (sign-in). |
| `TRANSLATE_GITHUB_CLIENT_SECRET` | yes | The App's client secret. |
| `TRANSLATE_GITHUB_PRIVATE_KEY` | yes¹ | The App's private key (PEM); a single line with `\n` escapes works too. |
| `TRANSLATE_GITHUB_PRIVATE_KEY_FILE` | yes¹ | Instead: path to the `.pem` file. |
| `TRANSLATE_WEBHOOK_SECRET` | yes | The App's webhook secret. Without it the webhook answers 503. |
| `TRANSLATE_TIME_ZONE` | – | IANA time zone for dates and times on the pages (default `Europe/Berlin`; an unknown name falls back to it with a log line). |
| `PORT` | – | Port of the server (default 3000). |
| `TRANSLATE_GITHUB_API` | – | Tests only: base URL of a GitHub API mock (the OAuth code exchange goes there too). |
| `TRANSLATE_COMPONENTS_FILE` | – | Another `components.json` (tests); default `components.json` in the working directory. |

¹ One of the two. Secrets come only from the environment – see [`.env.example`](.env.example).

## GitHub App

Create a GitHub App (Settings → Developer settings → GitHub Apps → New):

1. **Homepage URL**: `<TRANSLATE_URL>`.
2. **Callback URL**: `<TRANSLATE_URL>/api/auth/callback`. Leave "Expire user authorization tokens" as you like; **"Request user authorization (OAuth) during installation" off**.
3. **Webhook**: active, URL `<TRANSLATE_URL>/api/github/webhook`, a long random secret (→ `TRANSLATE_WEBHOOK_SECRET`).
4. **Repository permissions**: Contents **read & write**, Pull requests **read & write**, Metadata **read**. No account permissions.
5. **Subscribe to events**: **Push**.
6. Create the App, note the App ID and client id, generate a client secret and a private key.
7. **Install** the App on the repositories in `components.json` (yannicschuller/flowplan, flowplan-app, flowplan-desktop).

The tool finds the installation per repository (`GET /repos/{owner}/{repo}/installation`) with a JWT signed by the private key and uses short-lived installation tokens; commits and pull requests appear as the App.

## Deploy (Coolify)

The image is built on every push to main and published as `ghcr.io/yannicschuller/flowplan-translate:latest` (and `:sha-…`), for linux/amd64 and linux/arm64.

1. In Coolify, create a resource from the image (or the Dockerfile), port 3000.
2. Add a persistent volume at `/app/data`.
3. Set the environment variables above; `TRANSLATE_URL` must be the public **https** URL.
4. Coolify's reverse proxy terminates TLS; the healthcheck is `GET /api/health` → `{"service":"flowplan-translate","status":"ok"}`.
5. Optional: the repository secrets `COOLIFY_WEBHOOK` and `COOLIFY_TOKEN` let the Docker workflow roll out every new `:latest`.

After the first start, sign in as a reviewer and press "Sync now" for each repository (or push to main).

## Local development

```sh
npm ci
cp .env.example .env.local   # fill in what you need; without GitHub the pages work read-only
npm run dev                  # http://127.0.0.1:3000
```

Checks (all must be green before a commit):

```sh
npm run typecheck
npm test            # unit and route tests, no network (GitHub is a local mock)
npm run build
```

Browser smoke test (Playwright, after `npm run build`; set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to use an installed Chromium):

```sh
npm run test:browser
SCREENSHOTS_DIR=/tmp/shots npm run test:browser   # also screenshots of the main pages
```

It starts the standalone build with a temporary data directory, the fixture catalogues from `tests/fixtures/` and sessions created directly in the database – no GitHub, no real account.

## License

[AGPL-3.0-only](LICENSE), like Flowplan.
