package ai.osonai

import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.ApplicationInfo
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.security.SecureRandom

/**
 * The chat screen: a WebView with the Osonai chat bundle. It fills its parent. Give it the area
 * above the system bars and the keyboard (adjustResize, or window insets in an edge-to-edge app).
 * The app owns the view. It can take the view off screen and show it again: tool functions keep running
 * and the conversation stays. The view is dead ([isAlive] false) after [destroy], after [Osonai.release]
 * or when the WebView renderer stopped; then show a new OsonaiChatView. A new view starts a new conversation.
 */
@SuppressLint("SetJavaScriptEnabled", "ViewConstructor")
class OsonaiChatView(context: Context, private val osonai: Osonai) : FrameLayout(context) {
    private var webView: WebView? = WebView(context)
    private val main = Handler(Looper.getMainLooper())
    internal var ready = false

    // addJavascriptInterface puts OsonaiAndroid into every frame, also a view's sandboxed iframe, whose script
    // the model wrote. The page gets this key in init and sends it with every message; a view can't read it.
    private val bridgeKey: String = ByteArray(16).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }

    /** False after [destroy], after [Osonai.release] or after the WebView renderer stopped. */
    val isAlive: Boolean get() = webView != null

    init {
        osonai.view = this
        if (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) WebView.setWebContentsDebuggingEnabled(true)
        val web = webView!!
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.webViewClient = object : WebViewClient() {
            // The bridge is for the bundle only: the page never navigates to another document.
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true

            // Android 8 and later: without this, a renderer crash stops the whole app.
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                this@OsonaiChatView.destroy()
                osonai.onError?.invoke("The chat page stopped (the WebView renderer is gone). Show a new OsonaiChatView.")
                return true
            }
        }
        web.addJavascriptInterface(Bridge(), "OsonaiAndroid")
        addView(web, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        // An asset URL loads with the default allowFileAccess (false); the page origin is null,
        // so the Osonai server must answer CORS with "*".
        web.loadUrl("file:///android_asset/osonai/osonai-chat.html")
    }

    /**
     * Removes and destroys the WebView; the conversation of this view ends. Later messages to it are dropped.
     * [Osonai.release] destroys only the current view. When an Osonai lives longer than the Activity
     * (a ViewModel or a singleton), call this in the Activity's onDestroy. A second call does nothing.
     */
    fun destroy() {
        val web = webView ?: return
        webView = null
        ready = false
        if (osonai.view === this) osonai.view = null
        removeView(web)
        web.destroy()
    }

    private inner class Bridge {
        // Called on a WebView thread.
        @JavascriptInterface
        fun postMessage(s: String) {
            main.post { receive(s) }
        }
    }

    internal fun evaluate(m: JSONObject) {
        val text: String? = m.toString() // null for a value it cannot write (NaN, infinite)
        if (text == null) Log.e(TAG, "the ${m.optString("type")} message is not JSON (a NaN or infinite number?)") else evaluate(text)
    }

    private fun evaluate(text: String) {
        webView?.evaluateJavascript("window.__osonai.receive(${JSONObject.quote(text)})", null)
    }

    private fun receive(s: String) {
        if (webView == null) return
        val m = try {
            JSONObject(s)
        } catch (e: JSONException) {
            Log.w(TAG, "bad message from the chat page: ${s.take(200)}")
            return
        }
        val type = m.optString("type")
        if (type != "ready" && m.optString("key") != bridgeKey) {
            Log.w(TAG, "a $type message without the bridge key is dropped (a view's script?)")
            return
        }
        when (type) {
            // A second ready (a view can send one) gets the same init; the page ignores it.
            "ready" -> {
                ready = true
                evaluate(osonai.initMessage(loadUserId(), bridgeKey))
                osonai.flush(this)
            }
            "tool_call" -> {
                val id = m.optString("id")
                if (id.isEmpty()) Log.e(TAG, "a tool_call with no id is ignored") else runTool(id, m.optString("name"), m.optJSONObject("args") ?: JSONObject())
            }
            "user_id" -> m.optString("user_id").takeIf { it.isNotEmpty() }?.let(::saveUserId)
            "turn_end" -> osonai.onTurnEnd?.invoke(m.optString("text"), m.optJSONArray("tools").strings())
            "close" -> osonai.onClose?.invoke()
            "open" -> osonai.onOpen?.invoke(m.optString("kind"), m.optString("id"))
            "error" -> osonai.onError?.invoke(m.optString("message"))
            "log" -> if (osonai.config.debug) Log.println(if (m.optString("level") == "error") Log.ERROR else Log.DEBUG, TAG, m.optString("message"))
        }
    }

    // A failing store must not stop the chat: without the id the server issues a new one.
    private fun loadUserId(): String? = try {
        osonai.userIdStore(context).load()?.takeIf { it.isNotEmpty() }
    } catch (e: Exception) {
        Log.w(TAG, "could not load the user id: ${e.message}")
        null
    }

    private fun saveUserId(id: String) {
        try {
            osonai.userIdStore(context).save(id)
        } catch (e: Exception) {
            Log.w(TAG, "could not save the user id: ${e.message}")
        }
    }

    /**
     * Answers each tool_call exactly once, on screen or not, when the app function finishes.
     * The answer goes to this view's page; a dead view drops it. Only [Osonai.release] cancels the function.
     */
    private fun runTool(id: String, name: String, args: JSONObject) {
        fun failure(error: String) = message("tool_result").put("id", id).put("ok", false).put("error", error).toString()
        if (osonai.released) {
            Log.e(TAG, "tool_call $name after release(): answered ok false")
            return evaluate(failure(RELEASED))
        }
        if (name.isEmpty()) return evaluate(failure("The tool_call has no tool name."))
        val handler = osonai.tools[name] ?: return evaluate(failure("The app has no function for tool $name."))
        osonai.scope.launch {
            val answer = try {
                // put() throws for a NaN or infinite number; toString() gives null for one inside a Map or List.
                val text: String? = message("tool_result").put("id", id).put("ok", true).put("output", json(handler(args))).toString()
                text ?: throw JSONException("The app function returned a value that is not JSON (NaN or infinite).")
            } catch (e: Throwable) {
                // Any throw, also an Error such as TODO(), answers ok false. Only the cancel of release() ends
                // the coroutine; the page of an older view can still wait, so it gets an answer first.
                if (e is CancellationException && !isActive) {
                    evaluate(failure(RELEASED))
                    throw e
                }
                failure(e.message ?: e.toString())
            }
            evaluate(answer)
        }
    }

    private companion object {
        const val RELEASED = "This Osonai was released."

        fun json(v: Any?): Any = when (v) {
            null, Unit -> JSONObject.NULL
            else -> JSONObject.wrap(v) ?: v.toString()
        }

        fun JSONArray?.strings(): List<String> = if (this == null) emptyList() else List(length()) { getString(it) }
    }
}
