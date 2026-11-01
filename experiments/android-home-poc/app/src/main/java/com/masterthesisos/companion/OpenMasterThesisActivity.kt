package com.masterthesisos.companion

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.browser.customtabs.CustomTabsIntent

/** Opens one of a fixed set of web screens (never a caller-supplied URL), in a Custom Tab with browser fallback. */
object WebTargets {
    private val paths = mapOf(
        "home" to "/",
        "inbox" to "/?p=inbox",
        "planner" to "/?p=planner",
        "calendar" to "/?p=calendar",
    )

    fun url(target: String?): Uri? {
        val path = paths[target] ?: return null
        val base = BuildConfig.BASE_URL
        return if (base.startsWith("https://")) Uri.parse(base + path) else null
    }

    fun open(activity: Activity, target: String?): Boolean {
        val uri = url(target) ?: return false
        return runCatching { CustomTabsIntent.Builder().build().launchUrl(activity, uri) }
            .recoverCatching { activity.startActivity(Intent(Intent.ACTION_VIEW, uri)) }
            .isSuccess
    }
}

class OpenMasterThesisActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WebTargets.open(this, intent?.data?.lastPathSegment)
        finish()
    }
}
