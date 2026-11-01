package com.masterthesisos.companion.data

import android.content.Context
import com.masterthesisos.companion.auth.MobileSessionStore
import com.masterthesisos.companion.auth.SecureStore
import com.masterthesisos.companion.widget.updateAllWidgets
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.IOException
import java.util.UUID

/** What a widget renders. `error` is set when the last refresh failed and `snapshot` is older cached data. */
data class WidgetModel(
    val signedIn: Boolean,
    val snapshot: WidgetSnapshot?,
    val fetchedAtMillis: Long,
    val error: String?,
    val notice: String?,
)

/** Result of a completion attempt, mapped by the caller to widget wording. */
enum class CompleteResult { DONE, CONFLICT, OFFLINE, SIGNED_OUT, FAILED }

class WidgetRepository private constructor(private val context: Context) {
    private val session = MobileSessionStore(context)
    private val store = SecureStore(context)
    private val prefs = context.getSharedPreferences("op_ids", Context.MODE_PRIVATE)

    fun signedIn() = session.token() != null

    fun model(): WidgetModel {
        if (!signedIn()) return WidgetModel(false, null, 0, null, null)
        val cached = store.read(CACHE_FILE)?.let { runCatching { JSONObject(it) }.getOrNull() }
        val snapshot = cached?.optJSONObject("snapshot")?.let { runCatching { WidgetSnapshot.fromCache(it) }.getOrNull() }
        return WidgetModel(
            true, snapshot, cached?.optLong("fetchedAt") ?: 0L,
            cached?.optString("error")?.takeIf { it.isNotEmpty() }, cached?.optString("notice")?.takeIf { it.isNotEmpty() },
        )
    }

    /** Fetches fresh data. Only a successful, parsed response replaces the cached snapshot. */
    suspend fun refresh(): Boolean = withContext(Dispatchers.IO) {
        val token = session.token() ?: return@withContext false.also { updateAllWidgets(context) }
        val ok = try {
            val snapshot = MobileApiClient.fetchWidget(token)
            // A logout during the request must not resurrect personal data after the wipe.
            if (session.token() != token) return@withContext false.also { updateAllWidgets(context) }
            writeCache(snapshot, System.currentTimeMillis(), error = null, notice = null)
            true
        } catch (_: UnauthorizedException) {
            wipe() // expired / revoked: drop personal data, widgets ask for login
            false
        } catch (_: IOException) {
            markCacheError(ERROR_OFFLINE)
            false
        } catch (_: Exception) {
            markCacheError(ERROR_FAILED)
            false
        }
        updateAllWidgets(context)
        ok
    }

    suspend fun login(idToken: String) = withContext(Dispatchers.IO) {
        session.save(MobileApiClient.loginWithGoogle(idToken))
        refresh()
    }

    /** Wipes local session and personal data first; reports whether the server confirmed revocation. */
    suspend fun logout(): Boolean = withContext(Dispatchers.IO) {
        val token = session.token()
        wipe()
        val revoked = token?.let { MobileApiClient.logout(it) } ?: true
        updateAllWidgets(context)
        revoked
    }

    suspend fun completeTask(task: TaskItem): CompleteResult = withContext(Dispatchers.IO) {
        val token = session.token() ?: return@withContext CompleteResult.SIGNED_OUT
        // Same op_id for every retry of the same task version so the server can de-duplicate.
        val key = "${task.id}:${task.version}"
        val opId = prefs.getString(key, null) ?: "android-complete-${UUID.randomUUID()}".also { prefs.edit().putString(key, it).apply() }
        val result = try {
            MobileApiClient.completeTask(token, task.id, task.version, opId)
            prefs.edit().remove(key).apply()
            CompleteResult.DONE
        } catch (_: UnauthorizedException) {
            wipe()
            CompleteResult.SIGNED_OUT
        } catch (_: ConflictException) {
            prefs.edit().remove(key).apply()
            CompleteResult.CONFLICT
        } catch (_: IOException) {
            CompleteResult.OFFLINE
        } catch (_: Exception) {
            CompleteResult.FAILED
        }
        if (result == CompleteResult.SIGNED_OUT) {
            updateAllWidgets(context)
        } else {
            val notice = when (result) {
                CompleteResult.CONFLICT -> "다른 기기에서 변경됨"
                CompleteResult.OFFLINE -> "연결 필요"
                CompleteResult.FAILED -> "완료하지 못함"
                else -> null
            }
            // Never show success locally: always re-read the server state, then attach the notice.
            refresh()
            if (notice != null) {
                setNotice(notice)
                updateAllWidgets(context)
            }
        }
        result
    }

    private fun wipe() {
        session.clear()
        store.delete(CACHE_FILE)
        prefs.edit().clear().apply()
    }

    private fun writeCache(snapshot: WidgetSnapshot, fetchedAt: Long, error: String?, notice: String?) {
        store.write(
            CACHE_FILE,
            JSONObject().put("snapshot", snapshot.toJson()).put("fetchedAt", fetchedAt)
                .put("error", error ?: "").put("notice", notice ?: "").toString(),
        )
    }

    private fun markCacheError(error: String) = patchCache { it.put("error", error) }
    private fun setNotice(notice: String) = patchCache { it.put("notice", notice) }

    private fun patchCache(edit: (JSONObject) -> Unit) {
        val cached = store.read(CACHE_FILE)?.let { runCatching { JSONObject(it) }.getOrNull() } ?: return
        edit(cached)
        store.write(CACHE_FILE, cached.toString())
    }

    companion object {
        const val ERROR_OFFLINE = "offline"
        const val ERROR_FAILED = "failed"
        private const val CACHE_FILE = "snapshot.bin"

        @Volatile private var instance: WidgetRepository? = null
        fun get(context: Context): WidgetRepository = instance ?: synchronized(this) {
            instance ?: WidgetRepository(context.applicationContext).also { instance = it }
        }
    }
}
