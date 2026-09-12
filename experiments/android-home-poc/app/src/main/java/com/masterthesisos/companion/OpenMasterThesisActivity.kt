package com.masterthesisos.companion

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle

private const val MASTER_THESIS_OS_URL = "https://master-thesis-os.vercel.app"

class OpenMasterThesisActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val browserIntent = Intent(Intent.ACTION_VIEW, Uri.parse(MASTER_THESIS_OS_URL))
        runCatching { startActivity(browserIntent) }
        finish()
    }
}
