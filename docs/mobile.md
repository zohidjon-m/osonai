# Osonai on mobile: one chat bundle, three thin hosts

How the chat gets into a React Native, iOS or Android app, and the bridge between the native app and the chat
page. This is the contract every mobile part is built against. Install steps for app developers are in
[getting-started.md](getting-started.md) and each package's README. How we test all of this on simulators is in
[examples/shop/TESTING.md](../examples/shop/TESTING.md).

## The decision

The Harness (`@osonai/client`) already runs anywhere JavaScript runs and has no Node API. So the agent loop,
the chat screen and the transport ship **once**, as one self-contained HTML file. Each platform hosts that
file in a WebView inside the host app (a customer company's app that has the Osonai SDK inside) and contributes
only what must be native: **the host app's own tool functions**, called with the host app's own signed-in user
token.

```
 ┌───────────── host app (React Native / iOS / Android) ─────────────┐
 │  app code + API client + user token        Osonai host package     │
 │        ▲                                   (tool registry, bridge) │
 │        │ tool fn(args) → result                     ▲   │          │
 │        │                                   tool_call│   │tool_result
 │  ┌─────┴────────────── WebView: osonai-chat.html ───┴───▼───────┐  │
 │  │ chat screen · Harness (validate → resolve → bind → confirm   │  │
 │  │ → execute via bridge → allowlist) · HttpTransport            │  │
 │  └──────────────────────────────┬───────────────────────────────┘  │
 └─────────────────────────────────┼──────────────────────────────────┘
                                   │ HTTP, sessions + OpenAI chat completions, Authorization: Bearer <publishable key>
                       Osonai server (@osonai/runtime, serveRuntime)
                                   │
                              model provider
```

- The user token never enters the WebView. Only tool *results* do, and the Harness allowlists them.
- The host app's own backend server never sees Osonai; the host app calls it the way its buttons do.
- The Osonai server never calls the phone. Plain HTTP is enough.

## Packages

| Path | Name | What it is |
|---|---|---|
| `packages/embed` | `@osonai/embed` | the chat bundle source; `npm run build -w @osonai/embed` writes `dist/osonai-chat.html` (one file, all JavaScript and CSS inline) and copies it to the three host packages below |
| `packages/react-native` | `@osonai/react-native` | `<OsonaiChat>` on `react-native-webview`; compiled to `dist/` (JavaScript + `.d.ts`); `npm pack` gives the installable tarball |
| `packages/ios` | Swift package `OsonaiSDK` | `Osonai` (tool registry, config) + `OsonaiChatView` (SwiftUI) / `OsonaiChatViewController` (UIKit) on `WKWebView`; iOS 15+ |
| `packages/android` | `ai.osonai:osonai-android:0.1.0` | `Osonai` + `OsonaiChatView` on `android.webkit.WebView`; Kotlin; minSdk 24; an Android library archive (AAR), also published to Maven Local |

The generated copies of `osonai-chat.html` inside the host packages are committed, so a consumer needs no Node.

## Host ↔ chat bundle bridge (protocol version 1)

Every message is one JSON **string**. Every message has `"v": 1` and `"type"`.

Page → host, through the first channel that exists:

| Platform | Channel |
|---|---|
| React Native | `window.ReactNativeWebView.postMessage(str)` |
| iOS | `window.webkit.messageHandlers.osonai.postMessage(str)` |
| Android | `window.OsonaiAndroid.postMessage(str)` (`@JavascriptInterface`) |
| browser test | `window.parent.postMessage(str, "*")` when `window.parent !== window`, else `window.__osonaiTestHost(str)` |

Host → page: the host evaluates `window.__osonai.receive(<str>)`, where `<str>` is the message as a JavaScript
string literal (`JSON.stringify(JSON.stringify(msg))`). The page queues nothing before `ready`: the host waits
for `ready`, then sends `init`. Every host keeps `send` and `reset` calls made before `ready` in a queue and sends
them, in order, right after `init` (`context` does not wait: `init` carries the latest one). The page itself keeps a
`send` or `reset` that comes during a turn and runs it, in order, when the turn ends.

**The bridge key.** Each host makes one random key per web view (16 random bytes as hex) and sends it in `init`
as `config.bridgeKey`. From then on, every page → host message carries it as `key`, and the host drops any message
other than `ready` without the right key. Why: the bridge object is in every frame of the page (Android's
`addJavascriptInterface` and React Native's bridge inject it into all frames; iOS's message handler is reachable
from frames too), and with `views` the page runs scripts the model wrote, in sandboxed iframes. Such a script could
post a `tool_call` straight to the host and skip validation and the confirmation card. It can't read the page's
memory, so it can't know the key. A second `ready` (a view can post one) gets the same `init` again, which the page
ignores; the key never changes for the life of the web view. iOS also drops every message whose
`frameInfo.isMainFrame` is false.

| Direction | type | Fields | Meaning |
|---|---|---|---|
| page → host | `ready` | | the bundle is loaded; send `init` |
| host → page | `init` | `config` (below) | start; the page connects to the Osonai server |
| page → host | `tool_call` | `id`, `name`, `args` | run the host app's function for tool `name`; `args` are already validated, resolved and bound by the Harness (host app function argument names, for example `productId`) |
| host → page | `tool_result` | `id`, `ok`, `output` or `error` | the result; `error` is a plain message the model can read |
| host → page | `context` | `context` | what is on screen now (replaces the old context) |
| host → page | `send` | `text` | send a user message, as if typed |
| host → page | `reset` | | start a new conversation |
| page → host | `turn_end` | `text`, `tools` (names of tools run in the turn) | a turn finished; the host can refresh its screens. With `views`, `text` is the reply without its views, and a button in a view that ran a tool also sends one, with `text` `""` |
| page → host | `close` | | the user tapped the close button |
| page → host | `open` | `kind`, `id` | the user tapped a chat card whose manifest view has `open`, for example `kind` `product`, `id` `p_101`; the host app may open its own screen for it. Each host calls `onOpen(kind, id)` |
| page → host | `user_id` | `user_id` | the server issued this user id (a first launch, or it replaced an unknown id): save it and pass it as `config.userId` from now on. Sent only when it changed |
| page → host | `log` | `level`, `message` | for the host's debug log |
| page → host | `error` | `message` | the chat could not connect or a turn failed |

`config`:

```json
{
  "runtimeUrl": "https://sdk.oson.ai",
  "appKey": "<publishable key, osk_pub_…>",
  "manifest": { "...": "the app's harness/manifest.json" },
  "tools": ["search_products", "add_to_cart"],
  "context": { "current_screen": "home" },
  "title": "Bozor assistant",
  "greeting": "Hi! I can search products, manage your cart and check orders.",
  "suggestions": ["Find red sneakers", "What is in my cart?"],
  "placeholder": "Type a message",
  "theme": { "primary": "#0F766E", "mode": "system" },
  "showClose": true,
  "views": true,
  "design": { "colors": { "primary": "#007AFF", "background": "#FFFFFF", "text": "#11181C" }, "dark": { "primary": "#0A84FF" }, "style": "clean iOS look, rounded cards" },
  "imageOrigins": ["https://cdn.bozor.uz"],
  "bridgeKey": "<16 random bytes as hex, made by the host>"
}
```

`views` (optional, default false): the model may answer with views, HTML it writes, that the chat shows and the
user can tap ([Views](#views-the-model-writes)). Every host passes it through (`views` in React Native,
`OsonaiConfig.views` in iOS and Android). `design` (optional): the app's `harness/design.json`, the colors, font and
style of those views (React Native: the `design` prop; iOS: `OsonaiConfig.design`, JSON bytes; Android:
`OsonaiConfig.designJson`, its text). Without it, views take `theme.primary`. `imageOrigins` (optional): the
origins views may load pictures from, usually the app's image server or CDN, as exact `https://host[:port]`
origins (paths are cut off; anything that is not an http or https origin is dropped). A picture's address can carry
data, so list only servers the app owns, never a host that serves addresses users can choose. Without it, views
show no pictures from addresses. Every host passes it through (`imageOrigins` in React Native, iOS and Android).
Use https in production: iOS (ATS) and Android (cleartext rules) block plain http unless the app allows it. `bridgeKey`: see
[the bridge key](#host--chat-bundle-bridge-protocol-version-1); the three host packages make it themselves.

`userId` (optional): the id from the last `user_id` message; leave it out on an install's first launch. Never make
one up: the server issues ids and replaces any it did not issue. The hosts keep it themselves (iOS: Keychain,
Android: SharedPreferences, React Native: the `userIdStore` prop, else the page's own `localStorage` copy).
See [User identity](#user-identity).

`debug` (optional, default false): when true, the page sends its trace lines to the host as `log` messages.
`tools` lists the tools the host registered. The page binds each one in the Harness to a function that sends
`tool_call` and waits for the `tool_result` with the same `id`. A host that has no function for a name answers
`ok: false`. `theme.mode` is `light`, `dark` or `system`.

`strings` (optional, for example `{ "notNow": "Hozir emas" }`): replaces built-in texts of the chat screen, by key.
Every built-in text is in `STRINGS` in `packages/embed/src/ui.ts`, in English; a key the host leaves out keeps its
English text, so a host can pass nothing. The three host packages pass it through (`strings` in React Native, `OsonaiConfig.strings` in iOS and Android). `title` and `placeholder` in `config` win over `strings.title` and `strings.placeholder`. A host that
replaces a text the smoke flows find (below) must change its flows too.

### Chat screen (what a user and a UI smoke test see)

The same skeleton in every host app. Content comes from the model's text and the tool calls only: the screen
has no texts, cards or numbers that are made for one host app.

- A header with `title`, a New chat button (it starts a new conversation, like `reset`; a running turn stops first)
  and, when `showClose`, a close button. The close button is an icon; its text `Close` is in the button (visually
  hidden), so a test finds it by the text `Close`.
- Before the first message: the greeting, a line that answers can be wrong, and up to 3 `suggestions` as chips.
  The chips go away at the first message.
- On send, the user's message moves to just under the header and the reply grows below it. The view does not
  follow the reply; a `Latest` button shows when the reply goes past the bottom edge.
- While the turn waits for the model: a dot and the visible text `Thinking…`, until the first text or step line.
  `Thinking…` is not shown while a confirmation card waits.
- The model's text streams in with Markdown (bold, italic, lists, inline code, code blocks, tables). The text
  is built as DOM text, never as HTML. No link opens: a page that loads in the web view gets the host bridge. A
  Markdown link to an `http`, `https` or `mailto` address shows as "label (address)"; any other link shows the label
  only. A host message that opens a link in the system browser is not built yet.
- A step line for each tool call the model makes, after 100 ms: the plain tool name (`search_products` shows as
  "Search products"), then "✓ Search products · 1 s" or "Search products · Failed".
- Cards for a tool result, under its step line or its confirmation card, when the manifest entry of the tool has a
  `view` (`packages/core/src/types.ts`, `ViewSpec`; drawn by `packages/embed/src/views.ts`). Two kinds, the same for
  every host app: a `list` (`layout` `cards`: cards with big pictures that scroll sideways; `rows`: stacked rows with
  a small picture, an optional total line) and a `detail` (picture, title, value, badge, facts, and an optional list
  under it). The page reads the whole result of the host app function (`raw`, not the `output_fields` copy that the
  model gets), so pictures and other fields that the model does not need still show. Every value is a text node; a
  picture address must be `http` or `https`. A card with `open` is a button; a tap posts `open`. The Osonai server
  tells the model that these tools show cards, so it writes one short sentence instead of the list
  (`packages/runtime/src/prompt.ts`).
- A confirmation card for a tool with `confirmation: "confirm"` or `kind: "destructive"`, drawn by the page, never
  by the model: the plain tool name as the title, the tool's description, its arguments in plain words, the line
  "Nothing changes until you tap <name>.", and two buttons. The action button's text is the plain tool name
  (`add_to_cart`: `Add to cart`, `remove_from_cart`: `Remove from cart`); the other button's text is `Not now`.
  For `kind: "destructive"` the action text is red. After a tap, the two buttons become one line with the word
  `Confirmed` or `Cancelled` ("Add to cart · Confirmed"); when the tool ends, " · Done" or " · Failed" is added.
  iOS gives the bare word as its own text node; Android gives the whole line as one node (the line takes the
  focus, `tabindex="-1"`), so a flow waits for `.*Confirmed.*`. No live buttons stay in the history.
- The input: a text area with the `placeholder`, HTML id `osonai-input`. Return makes a new line on a phone
  (`enterkeyhint="enter"`); Enter sends on a hardware keyboard.
- One button, HTML id `osonai-send`, in the same place: its text is `Send` when no turn runs (always enabled,
  also with an empty input) and `Stop` while a turn runs. Stop ends the turn: the reply keeps its text and is marked
  `Stopped` with a `Continue` chip (it sends "Continue"); a card that waits answers `Cancelled`.
- Under the last reply: Copy (it copies the plain text).
- Light and dark themes (CSS custom properties, `prefers-color-scheme`, overridden by `theme.mode`);
  `theme.primary` is the brand color of the Send button, the action button and the user bubble's tint.
- The page `<title>` is `Osonai chat`.

### Views the model writes

With `views: true`, the page adds the view rules to the manifest's `agent_instructions`, so the server puts them in
the system prompt (`packages/embed/src/rules.ts`), with the design's `style` line. The model then answers with text
and views: a view is a fenced block, a line `` ```ui ``, an HTML fragment (markup, `<style>`, `<script>`), and a
line `` ``` ``.

- The reply streams as before; a view shows as a placeholder until its closing line arrives, then as an iframe that
  grows to its content (`packages/embed/src/split.ts`, `htmlview.ts`). A view the reply never closes is dropped.
- Each view is an iframe with `sandbox="allow-scripts"` (an opaque origin: no access to the chat page, its storage
  or the bridge key) and a CSP that blocks every network request except pictures (`img-src`) from `imageOrigins`.
  The rules tell the model which picture addresses work; a picture that can't load is hidden, not shown as a broken
  icon. Its colors are CSS variables from `design`
  (`--primary`, `--bg`, `--text`, `--surface`, `--muted`, `--border`, `--primary-soft`, `--radius`, `--font`), light
  and dark; a forced `theme.mode` picks one.
- A view's script has `window.osonai`:
  - `osonai.run(tool, args)`: one tool call through the Harness, like a call the model makes (validation, resolvers,
    the confirmation card, the host's `tool_call`). It resolves to `{ok, output, error}`; `output` is the
    `output_fields` copy the model gets. A card for it shows at the end of the chat. The host gets a `turn_end` with
    the tool. The model hears of these runs with the next message ("Meanwhile I did this myself in the app: …").
  - `osonai.say(text)`: sends `text` as a user message.
  - `osonai.render(target, request)`: one model turn, not shown in the chat, whose reply is one view; the page puts it
    into `target` (an element or a selector) and runs its scripts.
- A tap waits while a reply runs, and runs when it ends; taps and messages run one at a time, in order.
- The model's views replace the manifest's template cards: with `views`, the page sends the manifest without `view`
  entries, so it draws no cards and the server does not tell the model to keep its answer to one sentence.
- Views are 1,300–2,400 output tokens. The Osonai server's default output limit, `OSONAI_MAX_OUTPUT_TOKENS=1024`,
  cuts them off: a server for apps with views needs about 8192.

## Osonai server

`runtimeUrl` is `https://sdk.oson.ai` in production. For a local server: `HOST=0.0.0.0 PORT=8089 npm run serve -- --cors '*'`
([operations.md](operations.md#settings) lists the settings).

- The page opens a session (`POST /v1/osonai/sessions`) with the manifest and its bound tools, then sends only new
  messages. The server keeps the conversation ([protocol.md](protocol.md)).
- `appKey` is the app's **publishable** key, sent as `Authorization: Bearer <key>`. On the hosted server we make it
  with the admin route ([getting-started.md](getting-started.md)); on a local server with
  `npm run osonai -- apps create <name> --owner <id> --cap <tokens>` (it prints both keys once). A missing or
  unknown key gets 401, a key over its daily cap 429.
- A WebView page loaded from a file has the origin `null`, so the server needs `--cors '*'`
  (or `OSONAI_CORS_ORIGIN=*`). Auth is a bearer key, never a cookie, so `*` is safe.
- The user id is issued by the server; see [User identity](#user-identity).

## User identity

The app developer provides nothing. The first time an install opens a chat, the server issues it a random id
(`usr_` + 22 characters), the page posts it to the host as `user_id`, and the host saves it and passes it as
`config.userId` in every later `init`. The server accepts only ids it issued for this app; any other value gets a
new id, never an error. A verified per-user token is planned ([roadmap.md](roadmap.md)).

| Host | Where the id is kept | Replace it with |
|---|---|---|
| iOS | Keychain, service `ai.osonai.sdk`, account `user_id`, `AfterFirstUnlock` | `OsonaiConfig.userIdStore` (`OsonaiUserIdStore`) |
| Android | SharedPreferences `ai.osonai.sdk`, key `user_id` | `OsonaiConfig.userIdStore` (`UserIdStore`) |
| React Native | the page's `localStorage` (WebView origin `http://localhost`) | the `userIdStore` prop (for example AsyncStorage or expo-secure-store) |

The id works like a password (whoever sends it is that user), so keep it out of logs; the server puts only a hash
of it in traces. A new id comes with: clearing app data, a new phone without a backup, a switch between iOS and
Android, and on Android a reinstall without a backup (the iOS Keychain usually survives a reinstall, but Apple
does not promise it).

