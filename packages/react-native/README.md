# @osonai/react-native

`<OsonaiChat>` puts the Osonai chat in a React Native host app (a customer company's app that has the
Osonai SDK inside).

The chat screen, the agent loop and the connection to the Osonai server run in one HTML page
inside `react-native-webview`. Your app gives only the tool functions. Each tool function calls
your own API client with your own signed-in user token. The token never goes into the chat page.
Only the tool results go there.

The bridge between the host app and the page is in `docs/mobile.md` of the Osonai SDK repository.

## Install in your app

1. Install the package and `react-native-webview`:

   ```sh
   npm install @osonai/react-native react-native-webview
   ```

2. iOS: install the pods. Node must be on `PATH`, because the Podfile runs `node`.

   ```sh
   cd ios && pod install
   ```

   If Xcode cannot find Node in the "Bundle React Native code and images" build phase, write
   `export NODE_BINARY=/absolute/path/to/node` in `ios/.xcode.env.local`.

3. Network. The chat page calls the Osonai server from the WebView. An `https` Osonai server needs
   no change. A plain `http` Osonai server (a test setup) needs:
   - iOS, `Info.plist`: `NSAppTransportSecurity` with `NSAllowsArbitraryLoads` and
     `NSAllowsArbitraryLoadsInWebContent` set to true.
   - Android, the main `AndroidManifest.xml`: `android:usesCleartextTraffic="true"` on `<application>`.

4. Build your app as usual. The package has no native code of its own. `react-native-webview` is
   autolinked.

These are the steps that Bozor, our test app (`examples/shop/rn`), uses (React Native 0.88.0, new
architecture, `react-native-webview` 14.0.1).

## Usage

```tsx
import { useRef } from 'react';
import { OsonaiChat, type OsonaiChatHandle } from '@osonai/react-native';
import manifest from './harness/manifest.json';
import { api } from './api'; // your own API client, with your user's token

export function AssistantScreen({ onClose, refreshCart }: { onClose(): void; refreshCart(): void }) {
  const chat = useRef<OsonaiChatHandle>(null);
  return (
    <OsonaiChat
      ref={chat}
      runtimeUrl="https://osonai.example.com"
      appKey="osk_pub_…"
      manifest={manifest}
      tools={{
        search_products: async (filters) => api.searchProducts(filters),
        add_to_cart: async ({ productId, quantity }) => api.addToCart(productId, quantity),
        view_cart: async () => api.getCart(),
      }}
      context={{ current_screen: 'home' }}
      title="Bozor assistant"
      greeting="Hi! I can search products, manage your cart and check orders."
      suggestions={['Find red sneakers', 'What is in my cart?']}
      showClose
      onTurnEnd={() => refreshCart()}
      onClose={onClose}
      onError={(message) => console.warn(message)}
    />
  );
}
```

`<OsonaiChat>` fills its parent (`flex: 1`). Put it in a full screen view, for example inside a
`SafeAreaView`. It keeps the chat input above the keyboard: on Android with a
`KeyboardAvoidingView` (an edge-to-edge window does not shrink for the keyboard), on iOS through
the web view.

### Tool functions

- One function for each tool name of the manifest. The function gets the arguments after the chat
  page has validated, resolved and bound them. The argument names are the names of your app
  function, for example `productId`, not the model names.
- The function returns any JSON value, or a promise of one. The chat page keeps only the
  `output_fields` of the manifest.
- When the function throws, the model gets the error message (`ok: false`). Write the message for
  the model, for example "No product is open on screen. Ask the user which product."
- A tool of the manifest with no function gets `ok: false`.
- Each call gets exactly one answer. The chat page stops waiting after 30 seconds.

## Props

| Prop | Type | Default | What it does |
|---|---|---|---|
| `runtimeUrl` | string | required | Address of the Osonai server. |
| `appKey` | string | required | The app's publishable key, sent as `Authorization: Bearer`. |
| `manifest` | object | required | The host app's `harness/manifest.json`. |
| `tools` | `Record<string, (args) => unknown>` | required | The host app functions, by tool name. |
| `context` | object | `{}` | What is on screen now, for example `{ current_screen: 'product', current_product_id: 'p_106' }`. A change (by value) goes to the chat at once. |
| `title` | string | `"Assistant"` | Header text. |
| `greeting` | string | none | First assistant message. |
| `suggestions` | string[] | none | Tappable chips under the greeting. |
| `placeholder` | string | `"Type a message"` | Text of the empty input. |
| `strings` | `Record<string, string>` | none | Replaces built-in texts of the chat screen by key, for example `{ notNow: 'Hozir emas' }`. The keys are in `STRINGS` in `packages/embed/src/ui.ts`. |
| `theme` | `{ primary?: string; mode?: 'light' \| 'dark' \| 'system' }` | `system` | Accent color and color mode. |
| `showClose` | boolean | false | Shows a `Close` button in the header. |
| `debug` | boolean | false | The chat page sends its trace lines to `console.log`, and the WebView can be inspected (Safari, Chrome). |
| `userIdStore` | `{ load(): Promise<string \| null \| undefined>; save(id): Promise<void> }` | none (the WebView's `localStorage`) | Keeps the user id the Osonai server issued to this install ([docs/mobile.md](../../docs/mobile.md#user-identity)). For example with AsyncStorage: `{ load: () => AsyncStorage.getItem('osonai.user_id'), save: (id) => AsyncStorage.setItem('osonai.user_id', id) }`. |
| `onTurnEnd` | `({ text, tools }) => void` | none | A turn ended. `tools` are the names of the tools that ran without error. Refresh your screens here. |
| `onClose` | `() => void` | none | The user tapped `Close`. |
| `onOpen` | `(kind: string, id: string) => void` | none | The user tapped a chat card whose manifest view has `open`, for example `('product', 'p_101')`. Open your own screen for it. |
| `onError` | `(message) => void` | none | The chat could not connect, or a turn failed. The chat also shows the message. |

The `ref` handle (`OsonaiChatHandle`):

| Method | What it does |
|---|---|
| `send(text)` | Sends a user message, as if typed. |
| `reset()` | Starts a new conversation. |

A `send` or `reset` during a turn waits for the end of the turn. The page keeps each call and then
runs them in order: two `send` calls during a turn give two turns, one after the other.

You can call `send` and `reset` at once, also before the chat page has loaded, for example in an
effect right after `<OsonaiChat>` mounts. The calls wait in a queue, in order, and go to the page
right after it starts. The queue stays when the page loads again. A change of `context` does not
wait: the page always starts with the latest `context`.

## Known limits

- The chat page reads the config once, when it loads. A later change of `runtimeUrl`, `appKey`,
  `manifest`, the tool names or the texts has no effect. Give `<OsonaiChat>` a new `key` to load it
  again. A change of `context` or of a tool function body has an effect at once.
- The conversation lives in the WebView. When `<OsonaiChat>` unmounts, the conversation is gone.
- When the system stops the process of the chat page (iOS: the web content process, Android: the
  WebView render process), the host app does not crash. The chat loads again in a new WebView and starts
  a new conversation. A tool result that was on its way to the old page is lost.
- The app key is in the host app binary, so it is not a secret. A short-lived user session token for
  the Osonai server is design only.
- Tested: iOS simulator (iOS 26.5) and Android emulator (Android 15, API 35), Release builds, React
  Native 0.88.0, new architecture. Not tested: real devices, the old architecture, Expo, React
  Native versions before 0.88.
