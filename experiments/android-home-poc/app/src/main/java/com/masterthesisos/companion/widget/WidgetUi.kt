package com.masterthesisos.companion.widget

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.action.Action
import androidx.glance.action.ActionParameters
import androidx.glance.action.clickable
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.updateAll
import androidx.glance.layout.Alignment
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import com.masterthesisos.companion.OpenMasterThesisActivity
import com.masterthesisos.companion.data.WidgetModel
import com.masterthesisos.companion.data.WidgetRepository
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

internal val Bg = Color(0xFF12171C)
internal val Surface = Color(0xFF1B2229)
internal val Accent = Color(0xFF5CC8B8)
internal val TextMain = Color(0xFFEEF3F5)
internal val TextSub = Color(0xFF9AA8B1)
internal val Warn = Color(0xFFF2B36B)

internal fun style(size: Int, color: Color = TextMain, bold: Boolean = false) =
    TextStyle(color = ColorProvider(color), fontSize = size.sp, fontWeight = if (bold) FontWeight.Bold else FontWeight.Normal)

/** Fixed, whitelisted destinations. The activity maps `chocomint://open/<target>` to an HTTPS URL. */
internal fun openAction(context: Context, target: String): Action = actionStartActivity(
    Intent(context, OpenMasterThesisActivity::class.java).setData(Uri.parse("chocomint://open/$target")),
)

suspend fun updateAllWidgets(context: Context) {
    CalendarWidget().updateAll(context)
    TodayTasksWidget().updateAll(context)
}

internal fun syncLabel(model: WidgetModel): String {
    val time = SimpleDateFormat("HH:mm", Locale.KOREA).format(Date(model.fetchedAtMillis))
    return when {
        model.error != null -> "마지막 동기화 $time · 오프라인 데이터"
        else -> "동기화 $time"
    }
}

class RefreshAction : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        WidgetRepository.get(context).refresh()
    }
}

@Composable
internal fun WidgetHeader(title: String, model: WidgetModel, onTitle: Action) {
    Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = style(15, TextMain, true), modifier = GlanceModifier.clickable(onTitle))
        Spacer(GlanceModifier.defaultWeight())
        Text(
            "↻",
            style = style(18, Accent, true),
            modifier = GlanceModifier.padding(horizontal = 6.dp).clickable(actionRunCallback<RefreshAction>()),
        )
    }
}

@Composable
internal fun Footer(model: WidgetModel) {
    if (model.signedIn && model.fetchedAtMillis > 0) {
        Row(modifier = GlanceModifier.fillMaxWidth().padding(top = 4.dp)) {
            Text(syncLabel(model), style = style(10, if (model.error != null) Warn else TextSub), maxLines = 1)
            model.notice?.let {
                Spacer(GlanceModifier.width(6.dp))
                Text(it, style = style(10, Warn, true), maxLines = 1)
            }
        }
    }
}
