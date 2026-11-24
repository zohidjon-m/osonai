// swift-tools-version: 5.9
// The Osonai SDK for iOS. Add this repository in Xcode: File → Add Package Dependencies.
import PackageDescription

let package = Package(
    name: "OsonaiSDK",
    platforms: [.iOS(.v15)],
    products: [.library(name: "OsonaiSDK", targets: ["OsonaiSDK"])],
    targets: [
        .target(
            name: "OsonaiSDK",
            path: "packages/ios/Sources/OsonaiSDK",
            resources: [.copy("Resources/osonai-chat.html"), .copy("Resources/PrivacyInfo.xcprivacy")]
        ),
    ]
)
