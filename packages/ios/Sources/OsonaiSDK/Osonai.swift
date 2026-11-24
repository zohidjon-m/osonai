import Foundation
import Security
import WebKit
import os

/// Chat colors. `primary` is a CSS color, for example "#0F766E".
public struct OsonaiTheme {
    public enum Mode: String { case light, dark, system }
    public var primary: String?
    public var mode: Mode

    public init(primary: String? = nil, mode: Mode = .system) {
        self.primary = primary
        self.mode = mode
    }
}

public struct OsonaiConfig {
    /// The Osonai server, for example https://sdk.oson.ai.
    public var runtimeURL: URL
    /// The app's publishable key (osk_pub_…), sent as Authorization: Bearer.
    public var appKey: String
    /// The app's harness/manifest.json, as JSON bytes.
    public var manifest: Data
    public var title: String?
    public var greeting: String?
    /// Tappable chips under the greeting, before the first message.
    public var suggestions: [String]
    public var placeholder: String?
    /// Replaces built-in texts of the chat screen by key, for example ["notNow": "Hozir emas"] (docs/mobile.md).
    public var strings: [String: String]
    public var theme: OsonaiTheme
    /// Shows a Close button in the chat header; a tap calls `onClose`.
    public var showClose: Bool
    /// The page sends its trace lines to the host log (os.Logger, subsystem "ai.osonai.sdk").
    public var debug: Bool
    /// Where the user id the Osonai server issued is kept. Default: the Keychain (docs/mobile.md, "User identity").
    public var userIdStore: OsonaiUserIdStore
    /// The model may answer with views (HTML it writes) that the chat shows and the user can tap (docs/mobile.md).
    public var views: Bool
    /// The app's harness/design.json, as JSON bytes: the colors, font and style of those views.
    public var design: Data?
    /// Origins those views may load pictures from, for example ["https://cdn.example.com"]. Nothing else loads.
    public var imageOrigins: [String]

    public init(runtimeURL: URL, appKey: String, manifest: Data, title: String? = nil, greeting: String? = nil,
                suggestions: [String] = [], placeholder: String? = nil, strings: [String: String] = [:],
                theme: OsonaiTheme = OsonaiTheme(), showClose: Bool = false, debug: Bool = false,
                userIdStore: OsonaiUserIdStore = KeychainUserIdStore(), views: Bool = false, design: Data? = nil,
                imageOrigins: [String] = []) {
        self.runtimeURL = runtimeURL
        self.appKey = appKey
        self.manifest = manifest
        self.title = title
        self.greeting = greeting
        self.suggestions = suggestions
        self.placeholder = placeholder
        self.strings = strings
        self.theme = theme
        self.showClose = showClose
        self.debug = debug
        self.userIdStore = userIdStore
        self.views = views
        self.design = design
        self.imageOrigins = imageOrigins
    }
}

/// Keeps the user id the Osonai server issued to this install. The id works like a password: keep it out of
/// logs. Called on the main thread; keep it quick.
public protocol OsonaiUserIdStore {
    func load() -> String?
    func save(_ id: String)
}

/// The default store: a Keychain generic password, service "ai.osonai.sdk", account "user_id",
/// kSecAttrAccessibleAfterFirstUnlock. Not ThisDeviceOnly, so encrypted backups and phone-to-phone transfer
/// restore it; not synchronizable, so it stays off iCloud Keychain. It usually survives deleting the app, but
/// Apple does not promise that. Not keyed by the app key: keys can be rotated, and the Keychain is already the app's own.
public struct KeychainUserIdStore: OsonaiUserIdStore {
    private let service = "ai.osonai.sdk"
    private let account = "user_id"

    public init() {}

    public func load() -> String? {
        var query = base
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    public func save(_ id: String) {
        let data = Data(id.utf8)
        let status = SecItemUpdate(base as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        guard status == errSecItemNotFound else { return }
        var add = base
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(add as CFDictionary, nil)
    }

    private var base: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }
}

/// The app's side of the chat: its tool functions, what is on screen, and the chat callbacks.
/// The callbacks are called on the main thread.
@MainActor
public final class Osonai {
    /// Gets the arguments the Harness bound (app-function names, for example "productId") and runs off
    /// the main thread. Returns any JSON value (dictionaries, arrays, strings, numbers, booleans, nil)
    /// or an Encodable (a Date inside it becomes ISO 8601 text); a dictionary or array must hold only JSON values.
    /// A thrown error goes to the model as its message.
    public typealias Tool = @Sendable ([String: Any]) async throws -> Any?

    public let config: OsonaiConfig
    /// What is on screen now. An open chat gets it at once; a chat that opens later gets it at start.
    public var context: [String: Any] = [:] {
        didSet { post(["type": "context", "context": context]) }
    }
    /// A turn finished: the reply text and the names of the tools that ran.
    public var onTurnEnd: ((_ text: String, _ tools: [String]) -> Void)?
    public var onClose: (() -> Void)?
    /// The user tapped a card in the chat that names a host app screen (manifest view `open`), for example
    /// kind "product" and the product id. Open that screen here.
    public var onOpen: ((_ kind: String, _ id: String) -> Void)?
    /// The chat could not connect, or a turn failed.
    public var onError: ((_ message: String) -> Void)?

    private var tools: [String: Tool] = [:]
    /// The chat on screen: the target of context, send and reset.
    private weak var webView: WKWebView?
    /// The chat pages that got init.
    private let startedPages = NSHashTable<WKWebView>.weakObjects()
    private var queue: [[String: Any]] = []
    private let log = Logger(subsystem: "ai.osonai.sdk", category: "chat")
    /// One random key per chat web view, sent in init. The page sends it with every message after init;
    /// a view the model wrote runs in a sandboxed frame and can't read it (docs/mobile.md).
    private let bridgeKeys = NSMapTable<WKWebView, NSString>.weakToStrongObjects()

    public init(config: OsonaiConfig) {
        self.config = config
    }

    /// Registers the app's function for a manifest tool. Register before the chat opens.
    public func tool(_ name: String, _ fn: @escaping Tool) {
        tools[name] = fn
    }

    /// Sends a user message, as if typed. Before the chat is open, it waits for the next chat.
    public func send(_ text: String) {
        post(["type": "send", "text": text])
    }

    /// Starts a new conversation.
    public func reset() {
        post(["type": "reset"])
    }

    /// A new chat page loads in this web view; messages wait for its `ready`.
    func attach(_ webView: WKWebView) {
        self.webView = webView
        startedPages.remove(webView)
    }

    /// The chat leaves the screen (closed, or covered): send and reset wait for the next chat on screen.
    func hide(_ webView: WKWebView) {
        if self.webView === webView { self.webView = nil }
    }

    /// The chat is on screen again (a cancelled dismiss, or the screen above it closed).
    func show(_ webView: WKWebView) {
        self.webView = webView
        guard startedPages.contains(webView) else { return } // not ready yet: its ready starts it
        evaluate(["type": "context", "context": context], in: webView) // it missed the changes while hidden
        flush()
    }

    func receive(_ body: Any, from webView: WKWebView?, isMainFrame: Bool) {
        guard let webView, let text = body as? String,
              let msg = (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any] else { return }
        let type = msg["type"] as? String
        // Only the chat page: not a frame inside it (a view the model wrote), and every message after init with the key.
        guard isMainFrame, type == "ready" || msg["key"] as? String == bridgeKey(for: webView) else {
            log.warning("a \(type ?? "", privacy: .public) message from a frame or without the bridge key is dropped")
            return
        }
        switch type {
        case "ready": start(webView)
        case "tool_call": run(msg, in: webView)
        case "user_id":
            if let id = msg["user_id"] as? String, !id.isEmpty { config.userIdStore.save(id) }
        case "turn_end": onTurnEnd?(msg["text"] as? String ?? "", msg["tools"] as? [String] ?? [])
        case "close": onClose?()
        case "open": onOpen?(msg["kind"] as? String ?? "", msg["id"] as? String ?? "")
        case "error": fail(msg["message"] as? String ?? "unknown error")
        case "log":
            log.debug("\(msg["level"] as? String ?? "", privacy: .public): \(msg["message"] as? String ?? "", privacy: .public)")
        default: break
        }
    }

    private func start(_ webView: WKWebView) {
        guard let manifest = try? JSONSerialization.jsonObject(with: config.manifest) else {
            return fail("Osonai: the manifest is not valid JSON")
        }
        var theme: [String: Any] = ["mode": config.theme.mode.rawValue]
        theme["primary"] = config.theme.primary
        var c: [String: Any] = [
            "runtimeUrl": config.runtimeURL.absoluteString, "appKey": config.appKey, "manifest": manifest,
            "tools": Array(tools.keys), "context": context, "suggestions": config.suggestions, "theme": theme,
            "showClose": config.showClose, "debug": config.debug, "strings": config.strings,
        ]
        c["title"] = config.title
        c["greeting"] = config.greeting
        c["placeholder"] = config.placeholder
        if let id = config.userIdStore.load(), !id.isEmpty { c["userId"] = id }
        c["views"] = config.views
        c["imageOrigins"] = config.imageOrigins
        if let data = config.design {
            guard let design = try? JSONSerialization.jsonObject(with: data) else {
                return fail("Osonai: the design is not valid JSON")
            }
            c["design"] = design
        }
        c["bridgeKey"] = bridgeKey(for: webView)
        evaluate(["type": "init", "config": c], in: webView)
        startedPages.add(webView)
        if self.webView === webView { flush() } // a chat that already left the screen gets no queued message
    }

    /// The same key for the life of the web view, also after its page reloads.
    private func bridgeKey(for webView: WKWebView) -> String {
        if let key = bridgeKeys.object(forKey: webView) { return key as String }
        var bytes = [UInt8](repeating: 0, count: 16)
        if SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) != errSecSuccess {
            bytes = (0..<16).map { _ in UInt8.random(in: 0...255) } // SystemRandomNumberGenerator, also a secure source
        }
        let key = bytes.map { String(format: "%02x", $0) }.joined()
        bridgeKeys.setObject(key as NSString, forKey: webView)
        return key
    }

    private func flush() {
        guard let webView else { return }
        let messages = queue
        queue = []
        messages.forEach { evaluate($0, in: webView) }
    }

    /// Answers one tool_call with exactly one tool_result. The app's function runs off the main thread.
    private func run(_ msg: [String: Any], in webView: WKWebView) {
        let id = msg["id"] as? String ?? "", name = msg["name"] as? String ?? ""
        let args = msg["args"] as? [String: Any] ?? [:]
        guard let fn = tools[name] else {
            return evaluate(["type": "tool_result", "id": id, "ok": false, "error": "The app has no function for tool \(name)."], in: webView)
        }
        Task { [weak self, weak webView] in
            var result: [String: Any] = ["type": "tool_result", "id": id, "ok": true]
            do {
                result["output"] = try Self.json(try await fn(args)) // fn is @Sendable, so it is not on the main actor
            } catch {
                result["ok"] = false
                result["error"] = Self.message(error)
            }
            if let self, let webView { self.evaluate(result, in: webView) }
        }
    }

    private static func json(_ value: Any?) throws -> Any {
        guard let value else { return NSNull() }
        if JSONSerialization.isValidJSONObject([value]) { return value }
        if let value = value as? Encodable {
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601 // the default is seconds since 2001, which the model cannot read
            return try JSONSerialization.jsonObject(with: encoder.encode(value), options: .fragmentsAllowed)
        }
        throw NSError(domain: "Osonai", code: 1, userInfo: [NSLocalizedDescriptionKey: "The app function returned a value that is not JSON."])
    }

    /// Objective-C and Foundation errors (also URLError and CocoaError) and errors with a description text in
    /// their user info read well as localizedDescription. Any other Swift error (also a CustomNSError) reads only
    /// "The operation couldn't be completed", so its own description is the readable text.
    private static func message(_ error: Error) -> String {
        if let text = (error as? LocalizedError)?.errorDescription { return text }
        let ns = error as NSError
        if type(of: error) is NSError.Type || error is URLError || error is CocoaError
            || ns.userInfo[NSLocalizedDescriptionKey] != nil { return ns.localizedDescription }
        return String(describing: error)
    }

    private func post(_ msg: [String: Any]) {
        guard let webView, startedPages.contains(webView) else {
            // The next chat's init carries the latest context, so only send and reset wait.
            if msg["type"] as? String != "context" { queue.append(msg) }
            return
        }
        evaluate(msg, in: webView)
    }

    /// Host → page: window.__osonai.receive(<the message as a JavaScript string literal>).
    private func evaluate(_ msg: [String: Any], in webView: WKWebView) {
        var msg = msg
        msg["v"] = 1
        // JSONSerialization raises an Objective-C exception (a crash) for a value that is not JSON: check first.
        guard JSONSerialization.isValidJSONObject(msg), let json = try? JSONSerialization.data(withJSONObject: msg),
              let literal = try? JSONSerialization.data(withJSONObject: String(decoding: json, as: UTF8.self), options: .fragmentsAllowed)
        else { return fail("Osonai: the \(msg["type"] ?? "") message is not JSON (check the context values)") }
        webView.evaluateJavaScript("window.__osonai.receive(\(String(decoding: literal, as: UTF8.self)))")
    }

    private func fail(_ message: String) {
        log.error("\(message, privacy: .public)")
        onError?(message)
    }
}
