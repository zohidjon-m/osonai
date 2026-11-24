import SwiftUI

/// The chat screen (SwiftUI). Each new view is a new conversation.
/// Add `.ignoresSafeArea()`: the page handles the safe area itself.
public struct OsonaiChatView: UIViewControllerRepresentable {
    public let osonai: Osonai

    public init(osonai: Osonai) {
        self.osonai = osonai
    }

    public func makeUIViewController(context: Context) -> OsonaiChatViewController {
        OsonaiChatViewController(osonai: osonai)
    }

    public func updateUIViewController(_ controller: OsonaiChatViewController, context: Context) {}
}
