package com.masterthesisos.companion

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.GetCredentialProviderConfigurationException
import androidx.credentials.exceptions.GetCredentialUnsupportedException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException
import com.masterthesisos.companion.auth.GoogleSignInManager
import com.masterthesisos.companion.data.WidgetRepository
import com.masterthesisos.companion.sync.WidgetRefreshWorker
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Native entry screen: sign-in state, last sync time and the three main destinations. */
class MainActivity : Activity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val repo by lazy { WidgetRepository.get(this) }
    private lateinit var status: TextView
    private lateinit var sync: TextView
    private lateinit var message: TextView
    private lateinit var signIn: Button
    private lateinit var signOut: Button
    private lateinit var refresh: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 96, 48, 48)
            gravity = Gravity.START
        }
        fun text(size: Float, color: Int = Color.DKGRAY) = TextView(this).apply { textSize = size; setTextColor(color) }
        root.addView(text(26f, Color.BLACK).apply { this.text = "Chocomint Lab" })
        status = text(15f).also(root::addView)
        sync = text(13f, Color.GRAY).also(root::addView)
        message = text(13f, Color.rgb(176, 96, 0)).also(root::addView)
        signIn = button("Google 로그인", root) { signInClicked() }
        refresh = button("지금 새로고침", root) { scope.launch { run("새로고침 실패 — 연결을 확인해줘.") { repo.refresh() } } }
        button("오늘의 일정 보기", root) { open("calendar") }
        button("오늘의 할 일 보기", root) { open("planner") }
        button("AI 인박스 열기", root) { open("inbox") }
        signOut = button("로그아웃 및 기기 데이터 삭제", root) { signOutClicked() }
        root.addView(text(11f, Color.GRAY).apply { text = "웹 화면은 브라우저 로그인이 한 번 더 필요할 수 있어요." })
        setContentView(root)
    }

    override fun onResume() {
        super.onResume()
        render()
        if (repo.signedIn()) {
            WidgetRefreshWorker.schedule(this)
            scope.launch { repo.refresh(); render() }
        }
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    private fun button(label: String, parent: LinearLayout, onClick: () -> Unit) =
        Button(this).apply { text = label; setOnClickListener { onClick() } }.also(parent::addView)

    private fun open(target: String) {
        if (!WebTargets.open(this, target)) message.text = "웹 주소가 설정되지 않았거나 열 수 없어."
    }

    private fun render() {
        val model = repo.model()
        status.text = if (model.signedIn) "로그인됨" else "로그인 필요"
        sync.text = when {
            !model.signedIn -> ""
            model.fetchedAtMillis == 0L -> "아직 동기화 안 됨"
            else -> "마지막 동기화 " + SimpleDateFormat("HH:mm", Locale.KOREA).format(Date(model.fetchedAtMillis)) +
                if (model.error != null) " · 오프라인 데이터" else ""
        }
        signIn.isEnabled = !model.signedIn
        signOut.isEnabled = model.signedIn
        refresh.isEnabled = model.signedIn
    }

    private suspend fun run(failure: String, block: suspend () -> Boolean) {
        message.text = ""
        if (!runCatching { block() }.getOrDefault(false)) message.text = failure
        render()
    }

    private fun signInClicked() {
        scope.launch {
            message.text = ""
            try {
                val token = GoogleSignInManager.idToken(this@MainActivity)
                repo.login(token)
                WidgetRefreshWorker.schedule(this@MainActivity)
            } catch (e: Exception) {
                message.text = signInFailureMessage(e)
            }
            render()
        }
    }

    /** Maps the failure to its real type so a setup problem is not reported as a network or account problem. */
    private fun signInFailureMessage(e: Exception): String = when (e) {
        is GetCredentialCancellationException -> "로그인을 취소했어."
        is NoCredentialException -> "이 기기에 Google 계정이 없어. 계정을 추가한 뒤 다시 시도해줘."
        is GetCredentialProviderConfigurationException ->
            "Google 로그인 설정이 맞지 않아. 패키지 이름과 SHA-1 등록을 확인해줘."
        is GetCredentialUnsupportedException -> "이 기기는 Google 로그인을 지원하지 않아."
        is GetCredentialException -> "Google 로그인 실패(${e.type})."
        is GoogleIdTokenParsingException -> "Google 응답을 읽지 못했어."
        is IllegalStateException -> "앱 설정 오류: ${e.message}"
        else -> "로그인 실패(${e.javaClass.simpleName}). 연결 상태를 확인해줘."
    }

    private fun signOutClicked() {
        scope.launch {
            WidgetRefreshWorker.cancel(this@MainActivity)
            val revoked = repo.logout()
            message.text = if (revoked) "" else "기기 데이터는 삭제했지만 서버 세션 폐기를 확인하지 못했어. 서버에서 세션이 아직 유효할 수 있어."
            render()
        }
    }
}
