package com.masterthesisos.companion

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
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
            } catch (_: Exception) {
                message.text = "로그인에 실패했어. 허용된 계정인지, 연결 상태를 확인해줘."
            }
            render()
        }
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
