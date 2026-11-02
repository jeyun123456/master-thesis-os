package com.masterthesisos.companion.auth

import android.app.Activity
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.masterthesisos.companion.BuildConfig

object GoogleSignInManager {
    /**
     * Returns a Google ID token for the server to verify; the app never sees any Google refresh token.
     * GetSignInWithGoogleOption shows the account chooser for a button-initiated sign-in,
     * unlike GetGoogleIdOption, which is meant for silent or one-tap flows.
     */
    suspend fun idToken(activity: Activity): String {
        check(BuildConfig.GOOGLE_WEB_CLIENT_ID.isNotEmpty()) { "chocomint.googleWebClientId is not configured" }
        val option = GetSignInWithGoogleOption.Builder(BuildConfig.GOOGLE_WEB_CLIENT_ID).build()
        val result = CredentialManager.create(activity)
            .getCredential(activity, GetCredentialRequest.Builder().addCredentialOption(option).build())
        val credential = result.credential
        check(credential is CustomCredential && credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
            "unexpected credential type"
        }
        return GoogleIdTokenCredential.createFrom(credential.data).idToken
    }
}
