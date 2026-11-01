package com.masterthesisos.companion.data

import com.masterthesisos.companion.BuildConfig
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

class UnauthorizedException : IOException("unauthorized")
class ConflictException : IOException("conflict")
class ApiException(val status: Int) : IOException("http $status")

/** HTTPS-only client for `/api/mobile/**`. The Bearer token is only ever sent in the Authorization header. */
object MobileApiClient {
    private fun open(path: String, method: String, token: String?, body: JSONObject?): Pair<Int, String> {
        val base = BuildConfig.BASE_URL
        check(base.startsWith("https://")) { "BASE_URL must be https" }
        val connection = URL(base + path).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = if (method == "PATCH") "POST" else method
            if (method == "PATCH") connection.setRequestProperty("X-HTTP-Method-Override", "PATCH")
            connection.connectTimeout = 10_000
            connection.readTimeout = 15_000
            connection.instanceFollowRedirects = false
            connection.setRequestProperty("Accept", "application/json")
            if (token != null) connection.setRequestProperty("Authorization", "Bearer $token")
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            return status to (stream?.bufferedReader()?.use { it.readText() } ?: "")
        } finally {
            connection.disconnect()
        }
    }

    private fun ensureOk(status: Int) {
        when {
            status == 401 -> throw UnauthorizedException()
            status == 409 -> throw ConflictException()
            status !in 200..299 -> throw ApiException(status)
        }
    }

    fun loginWithGoogle(idToken: String): String {
        val (status, text) = open(
            "/api/mobile/auth/google", "POST", null,
            JSONObject().put("id_token", idToken).put("device_label", "Chocomint Lab · Android"),
        )
        ensureOk(status)
        return JSONObject(text).getString("token").also { require(it.isNotBlank()) }
    }

    fun fetchWidget(token: String): WidgetSnapshot {
        val (status, text) = open("/api/mobile/widget", "GET", token, null)
        ensureOk(status)
        return WidgetSnapshot.fromApi(JSONObject(text))
    }

    fun completeTask(token: String, id: String, version: Int, opId: String) {
        val body = JSONObject().put("base_version", version).put("op_id", opId)
            .put("changes", JSONObject().put("status", "done"))
        ensureOk(open("/api/mobile/tasks/${java.net.URLEncoder.encode(id, "UTF-8")}", "PATCH", token, body).first)
    }

    /** @return true when the server confirmed the session was revoked. */
    fun logout(token: String): Boolean = runCatching { open("/api/mobile/auth/logout", "POST", token, JSONObject()).first in 200..299 }
        .getOrDefault(false)
}
