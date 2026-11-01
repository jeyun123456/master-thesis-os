package com.masterthesisos.companion.auth

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * AES-GCM files protected by an Android Keystore key. Holds the mobile session token and the
 * personal widget snapshot; files live in noBackupFilesDir so they never reach cloud backup.
 */
class SecureStore(context: Context) {
    private val dir = context.applicationContext.noBackupFilesDir

    @Synchronized
    fun write(name: String, value: String) {
        val cipher = Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.ENCRYPT_MODE, key()) }
        val sealed = cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        val target = File(dir, name)
        val temp = File(dir, "$name.tmp")
        temp.writeText(Base64.encodeToString(sealed, Base64.NO_WRAP))
        if (!temp.renameTo(target)) {
            target.delete()
            check(temp.renameTo(target)) { "secure store write failed" }
        }
    }

    @Synchronized
    fun read(name: String): String? {
        val file = File(dir, name)
        if (!file.exists()) return null
        return runCatching {
            val sealed = Base64.decode(file.readText(), Base64.NO_WRAP)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, sealed, 0, IV_BYTES))
            String(cipher.doFinal(sealed, IV_BYTES, sealed.size - IV_BYTES), Charsets.UTF_8)
        }.getOrElse {
            file.delete() // unreadable (key lost / corrupt): treat as absent rather than crash
            null
        }
    }

    @Synchronized
    fun delete(name: String) {
        File(dir, name).delete()
    }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    private companion object {
        const val KEY_ALIAS = "chocomint_lab_store_v1"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val IV_BYTES = 12
    }
}

/** Mobile Bearer session. Never logged, never placed in a URL. */
class MobileSessionStore(context: Context) {
    private val store = SecureStore(context)

    fun token(): String? = store.read(FILE)?.takeIf { it.isNotBlank() }
    fun save(token: String) = store.write(FILE, token)
    fun clear() = store.delete(FILE)

    private companion object {
        const val FILE = "session.bin"
    }
}
