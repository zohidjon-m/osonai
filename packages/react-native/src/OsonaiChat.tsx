// <OsonaiChat>: hosts the Osonai chat bundle (chat-html.ts) in a WebView and runs the app's own
// tool functions for it, over the bridge of docs/mobile.md (one JSON string per message, "v": 1).
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform } from "react-native";
import { WebView } from "react-native-webview";
import type { WebViewMessageEvent } from "react-native-webview";
import chatHtml from "./chat-html";

/** One app function per tool. It gets the arguments the Harness bound (app names, for example productId). */
export type OsonaiTool = (args: Record<string, any>) => unknown;

export interface OsonaiTheme {
  primary?: string;
  mode?: "light" | "dark" | "system";
}

/**
 * Keeps the user id the Osonai server issued to this install (docs/mobile.md, "User identity"), for example
 * with AsyncStorage or expo-secure-store. The id works like a password: keep it out of logs.
 */
export interface OsonaiUserIdStore {
  load(): Promise<string | null | undefined>;
  save(id: string): Promise<void>;
}

export interface OsonaiChatProps {
  runtimeUrl: string;
  appKey: string;
  /** The app's harness/manifest.json. */
  manifest: object;
  tools: Record<string, OsonaiTool>;
  /** What is on screen now. A change is sent to the chat. */
  context?: Record<string, unknown>;
  title?: string;
  greeting?: string;
  suggestions?: string[];
  placeholder?: string;
  /** Replaces built-in texts of the chat screen by key, for example { notNow: "Hozir emas" } (docs/mobile.md). */
  strings?: Record<string, string>;
  theme?: OsonaiTheme;
  showClose?: boolean;
  /** Trace lines from the chat go to console.log. */
  debug?: boolean;
  /** Where the user id is kept. Without it, the chat page keeps its own copy in the WebView's localStorage. */
  userIdStore?: OsonaiUserIdStore;
  /** The model may answer with views (HTML it writes) that the chat shows and the user can tap (docs/mobile.md). */
  views?: boolean;
  /** The app's harness/design.json: the colors, font and style of those views. */
  design?: object;
  /** Origins those views may load pictures from, for example ["https://cdn.example.com"]. Nothing else loads. */
  imageOrigins?: string[];
  onTurnEnd?: (turn: { text: string; tools: string[] }) => void;
  onClose?: () => void;
  onError?: (message: string) => void;
  /** A tap on a chat card: open the host app's screen of that kind for that item, for example ("product", "p_101"). The manifest view names the kind. */
  onOpen?: (kind: string, id: string) => void;
}

export interface OsonaiChatHandle {
  /** Sends a user message, as if typed. */
  send(text: string): void;
  /** Starts a new conversation. */
  reset(): void;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * A random key for one WebView. The WebView's bridge (ReactNativeWebView) is in every frame of the page, also
 * a view's sandboxed iframe, whose script the model wrote. The page gets the key in init and sends it with
 * every message; a view can't read it. Math.random is the fallback where the engine has no crypto: the
 * view's script runs in the WebView, not in this engine, so it can't see or predict it.
 */
function newBridgeKey(): string {
  const bytes = new Uint8Array(16);
  const c = (globalThis as { crypto?: { getRandomValues?(a: Uint8Array): Uint8Array } }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The saved user id, or undefined. A failing or slow store must not stop the chat: the server then issues a new id. */
async function loadUserId(store: OsonaiUserIdStore | undefined): Promise<string | undefined> {
  if (!store) return undefined;
  try {
    const id = await Promise.race([store.load(), new Promise<undefined>((r) => setTimeout(() => r(undefined), 2000))]);
    return typeof id === "string" && id ? id : undefined;
  } catch {
    return undefined;
  }
}

export const OsonaiChat = forwardRef<OsonaiChatHandle, OsonaiChatProps>(function OsonaiChat(props, ref) {
  // <object>: react-native-webview 14 types default the props generic to undefined, which makes every prop never.
  const web = useRef<WebView<object>>(null);
  const ready = useRef(false);
  // send and reset from the ref wait here until the page is ready, also across a reload. A context
  // message never waits: init carries the latest context.
  const queue = useRef<object[]>([]);
  const latest = useRef(props);
  latest.current = props;
  // A new key mounts a new WebView. Android cannot use a WebView again after its render process is gone.
  const [load, setLoad] = useState(0);
  // Counts WebView loads, so an init that waited for the user id store does not go to a newer WebView.
  const generation = useRef(0);
  // One per WebView: a new one on restart. A second ready from the same page keeps it.
  const bridgeKey = useRef("");
  if (!bridgeKey.current) bridgeKey.current = newBridgeKey();

  const post = (msg: object) => {
    if (!ready.current) return; // the page queues nothing before ready
    const str = JSON.stringify({ v: 1, ...msg });
    web.current?.injectJavaScript(`window.__osonai.receive(${JSON.stringify(str)});true;`);
  };
  const postOrQueue = (msg: object) => (ready.current ? post(msg) : void queue.current.push(msg));
  const restart = () => {
    ready.current = false;
    generation.current++;
    bridgeKey.current = newBridgeKey();
    setLoad((n) => n + 1);
  };

  useImperativeHandle(ref, () => ({ send: (text) => postOrQueue({ type: "send", text }), reset: () => postOrQueue({ type: "reset" }) }), []);

  // Compare by value: an inline context object is a new object on every render.
  const contextKey = JSON.stringify(props.context ?? {});
  useEffect(() => post({ type: "context", context: JSON.parse(contextKey) }), [contextKey]);

  const runTool = async (id: string, name: string, args: Record<string, any>) => {
    const fn = latest.current.tools[name];
    try {
      if (!fn) throw new Error(`The app has no function for tool ${name}.`);
      post({ type: "tool_result", id, ok: true, output: (await fn(args ?? {})) ?? null });
    } catch (e) {
      post({ type: "tool_result", id, ok: false, error: errorText(e) });
    }
  };

  // ready stays false until init is out, so nothing reaches the page before it (send and reset wait in the queue).
  const start = async () => {
    const mine = generation.current;
    const userId = await loadUserId(latest.current.userIdStore);
    if (mine !== generation.current) return; // the WebView was replaced meanwhile; its own ready starts it
    const p = latest.current;
    ready.current = true;
    post({
      type: "init",
      config: {
        runtimeUrl: p.runtimeUrl,
        appKey: p.appKey,
        manifest: p.manifest,
        tools: Object.keys(p.tools),
        context: p.context ?? {},
        title: p.title,
        greeting: p.greeting,
        suggestions: p.suggestions,
        placeholder: p.placeholder,
        strings: p.strings,
        theme: p.theme,
        showClose: p.showClose,
        debug: p.debug,
        userId,
        views: p.views,
        design: p.design,
        imageOrigins: p.imageOrigins,
        bridgeKey: bridgeKey.current,
      },
    });
    for (const q of queue.current.splice(0)) post(q);
  };

  const onMessage = (e: WebViewMessageEvent) => {
    let m: any;
    try {
      m = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    // Only the chat page: every message after ready carries its key; a view's script can't.
    if (!m || (m.type !== "ready" && m.key !== bridgeKey.current)) {
      if (latest.current.debug) console.log(`[osonai warn] a ${m?.type} message without the bridge key is dropped`);
      return;
    }
    const p = latest.current;
    switch (m.type) {
      case "ready": // also after a reload of the page: it starts again from init
        void start();
        break;
      case "user_id":
        // Promise.resolve: a store whose save throws or returns no promise must not break the chat.
        if (typeof m.user_id === "string" && m.user_id && p.userIdStore) {
          const store = p.userIdStore;
          Promise.resolve().then(() => store.save(m.user_id)).catch(() => {});
        }
        break;
      case "tool_call":
        void runTool(m.id, m.name, m.args);
        break;
      case "turn_end":
        p.onTurnEnd?.({ text: m.text ?? "", tools: m.tools ?? [] });
        break;
      case "close":
        p.onClose?.();
        break;
      case "error":
        p.onError?.(m.message);
        break;
      case "open":
        p.onOpen?.(String(m.kind), String(m.id));
        break;
      case "log":
        console.log(`[osonai ${m.level}] ${m.message}`);
        break;
    }
  };

  return (
    // Android apps draw edge to edge (React Native 0.81+), so the window no longer shrinks for the
    // keyboard and the input would stay behind it. On iOS the web view moves the input itself.
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" enabled={Platform.OS === "android"}>
      <WebView<object>
        key={load}
        ref={web}
        // An http origin, so the page's fetch to the Osonai server is a plain CORS request on every platform.
        source={{ html: chatHtml, baseUrl: "http://localhost" }}
        originWhitelist={["*"]}
        onMessage={onMessage}
        // No onLoadStart to clear ready: on Android it can arrive after the page's ready, and then every
        // post (tool results too) is dropped. The page never navigates; restart clears ready itself.
        // The system can stop the page's process (iOS: web content process, Android: render process).
        // Load the chat again in a new WebView; its ready starts it again from init.
        onContentProcessDidTerminate={restart}
        onRenderProcessGone={restart}
        webviewDebuggingEnabled={props.debug}
      />
    </KeyboardAvoidingView>
  );
});
