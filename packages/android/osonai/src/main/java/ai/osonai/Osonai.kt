package ai.osonai

import android.content.Context
import android.util.Log
import java.lang.ref.WeakReference
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import org.json.JSONArray
import org.json.JSONObject

/** The chat colors. [primary] is a CSS color, for example "#0F766E". */
data class OsonaiTheme(val primary: String? = null, val mode: Mode = Mode.SYSTEM) {
    enum class Mode { LIGHT, DARK, SYSTEM }
}

/** The chat settings. [manifestJson] is the text of the app's harness manifest.json. */
data class OsonaiConfig(
    val runtimeUrl: String,
    val appKey: String,
    val manifestJson: String,
    val title: String? = null,
    val greeting: String? = null,
    val suggestions: List<String> = emptyList(),
    val placeholder: String? = null,
    /** Replaces built-in texts of the chat screen by key, for example mapOf("notNow" to "Hozir emas") (docs/mobile.md). */
    val strings: Map<String, String> = emptyMap(),
    val theme: OsonaiTheme? = null,
    val showClose: Boolean = false,
    val debug: Boolean = false,
    /** Where the user id the Osonai server issued is kept. Null: SharedPreferences ([PrefsUserIdStore]). */
    val userIdStore: UserIdStore? = null,
    /** The model may answer with views (HTML it writes) that the chat shows and the user can tap (docs/mobile.md). */
    val views: Boolean = false,
    /** The text of the app's harness/design.json: the colors, font and style of those views. */
    val designJson: String? = null,
    /** Origins those views may load pictures from, for example listOf("https://cdn.example.com"). Nothing else loads. */
    val imageOrigins: List<String> = emptyList(),
)

/**
 * Keeps the user id the Osonai server issued to this install (docs/mobile.md, "User identity"). The id works
 * like a password: keep it out of logs. Called on the main thread; keep it quick.
 */
interface UserIdStore {
    fun load(): String?
    fun save(id: String)
}

/** The default store: SharedPreferences "ai.osonai.sdk", key "user_id". Android backup restores it if the app allows backup. */
class PrefsUserIdStore(context: Context) : UserIdStore {
    private val prefs = context.applicationContext.getSharedPreferences("ai.osonai.sdk", Context.MODE_PRIVATE)
    override fun load(): String? = prefs.getString("user_id", null)
    override fun save(id: String) {
        prefs.edit().putString("user_id", id).apply()
    }
}

/**
 * An app function for one tool. It gets the arguments the Harness validated, resolved and bound
 * (app-function names, for example productId) and returns any JSON value: JSONObject, JSONArray,
 * Map, List, String, number, Boolean or null. A throw answers the model with the message.
 * It runs on the main thread: switch to Dispatchers.IO for blocking work.
 */
typealias OsonaiTool = suspend (args: JSONObject) -> Any?

/**
 * One chat: the config, the app's tool functions, the screen context and the callbacks.
 * Show it with [OsonaiChatView]. Use it from the main thread. Call [release] when the chat ends for good.
 */
class Osonai(val config: OsonaiConfig) {
    private val manifest = JSONObject(config.manifestJson) // a bad manifest fails here, not in the WebView
    private val design = config.designJson?.let { JSONObject(it) } // a bad design file fails here too
    internal val tools = linkedMapOf<String, OsonaiTool>()
    private val outbox = mutableListOf<JSONObject>()

    /** Tool functions run here, also while the view is off screen. Only [release] cancels it. */
    internal val scope = MainScope()

    /** True after [release]: tools answer ok false, and [send] and [reset] are ignored. */
    internal var released = false
        private set

    // Weak: the app owns the view. An Osonai that outlives the Activity does not keep it.
    private var viewRef = WeakReference<OsonaiChatView>(null)
    internal var view: OsonaiChatView?
        get() = viewRef.get()
        set(v) {
            viewRef = WeakReference(v)
        }

    /** After each turn: the reply text and the names of the tools that ran. Refresh your screens here. */
    var onTurnEnd: ((text: String, tools: List<String>) -> Unit)? = null

    /** The user tapped Close (shown when [OsonaiConfig.showClose]). */
    var onClose: (() -> Unit)? = null

    /**
     * The user tapped a card in the chat that names a host app screen (manifest view `open`), for example
     * kind "product" and the product id. Open that screen here.
     */
    var onOpen: ((kind: String, id: String) -> Unit)? = null

    /** The chat could not connect to the Osonai server, or a turn failed. */
    var onError: ((message: String) -> Unit)? = null

    /** What is on screen now, for example current_screen and current_product_id. An open chat gets it at once. */
    var context: Map<String, Any?> = emptyMap()
        set(value) {
            field = value
            view?.takeIf { it.ready }?.evaluate(message("context").put("context", JSONObject(value)))
        }

    /** Registers the app function for tool [name]. Register every tool before the chat view loads. */
    fun tool(name: String, handler: OsonaiTool) {
        tools[name] = handler
    }

    /** Sends a user message, as if typed. */
    fun send(text: String) = post(message("send").put("text", text))

    /** Starts a new conversation. */
    fun reset() = post(message("reset"))

    /**
     * Ends this chat: cancels the tool functions that still run and destroys the chat view's WebView.
     * Call it once, for example in the Activity's onDestroy. Do not use this Osonai after it: a tool_call
     * answers ok false, and send and reset are ignored. Other chat views of this Osonai stay: destroy them.
     */
    fun release() {
        released = true
        scope.cancel()
        view?.destroy()
        view = null
        outbox.clear()
    }

    private fun post(m: JSONObject) {
        if (released) {
            Log.w(TAG, "${m.optString("type")}() after release() is ignored.")
            return
        }
        val v = view
        if (v != null && v.ready) v.evaluate(m) else outbox += m
    }

    /** The store for the user id: the config's, else SharedPreferences (needs a context, so made by the view). */
    internal fun userIdStore(context: Context): UserIdStore = config.userIdStore ?: PrefsUserIdStore(context)

    internal fun initMessage(userId: String?, bridgeKey: String): JSONObject = message("init").put(
        "config",
        JSONObject()
            .put("runtimeUrl", config.runtimeUrl)
            .put("appKey", config.appKey)
            .put("manifest", manifest)
            .put("tools", JSONArray(tools.keys))
            .put("context", JSONObject(context))
            .put("title", config.title)
            .put("greeting", config.greeting)
            .put("suggestions", JSONArray(config.suggestions))
            .put("placeholder", config.placeholder)
            .put("strings", JSONObject(config.strings))
            .put("theme", config.theme?.let { JSONObject().put("primary", it.primary).put("mode", it.mode.name.lowercase()) })
            .put("showClose", config.showClose)
            .put("debug", config.debug)
            .put("userId", userId) // a null value leaves the key out
            .put("views", config.views)
            .put("design", design)
            .put("imageOrigins", JSONArray(config.imageOrigins))
            .put("bridgeKey", bridgeKey),
    )

    /** Called by the view after init: what the app sent before the page was ready. */
    internal fun flush(v: OsonaiChatView) {
        outbox.forEach(v::evaluate)
        outbox.clear()
    }
}

internal const val TAG = "Osonai"

internal fun message(type: String): JSONObject = JSONObject().put("v", 1).put("type", type)
