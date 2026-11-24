# The chat page calls the bridge by name through addJavascriptInterface; R8 must keep it.
-keepclassmembers class ai.osonai.** {
    @android.webkit.JavascriptInterface <methods>;
}
