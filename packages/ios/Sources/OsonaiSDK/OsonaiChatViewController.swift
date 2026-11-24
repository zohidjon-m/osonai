import UIKit
import WebKit

/// The chat screen (UIKit). Each new controller is a new conversation.
public final class OsonaiChatViewController: UIViewController, WKNavigationDelegate {
    public let osonai: Osonai
    private let webView: WKWebView

    public init(osonai: Osonai) {
        self.osonai = osonai
        let config = WKWebViewConfiguration()
        // The content controller retains its handler; the weak proxy keeps the web view from holding Osonai.
        config.userContentController.add(WeakHandler(osonai), name: "osonai")
        webView = WKWebView(frame: .zero, configuration: config)
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    public override func loadView() {
        // The page draws under the status bar and the home indicator itself (viewport-fit=cover, safe-area insets).
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = false
        webView.isOpaque = false // no white flash before a dark page paints
        webView.backgroundColor = .systemBackground
        webView.navigationDelegate = self
        #if DEBUG
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        #endif
        view = webView
        load()
    }

    private func load() {
        let url = Bundle.module.url(forResource: "osonai-chat", withExtension: "html")!
        osonai.attach(webView)
        webView.loadFileURL(url, allowingReadAccessTo: url)
    }

    public override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        osonai.show(webView)
    }

    // viewWillDisappear, not viewDidDisappear: a send during the dismiss animation (about 0.3 s) waits for the next chat.
    public override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        osonai.hide(webView)
    }

    // iOS can stop the web content process (memory pressure). Load a new chat instead of a blank screen.
    public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        load()
    }
}

private final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var osonai: Osonai?

    init(_ osonai: Osonai) {
        self.osonai = osonai
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        // A frame inside the page (a view the model wrote) can call the handler too: the Osonai drops those.
        osonai?.receive(message.body, from: message.webView, isMainFrame: message.frameInfo.isMainFrame)
    }
}
