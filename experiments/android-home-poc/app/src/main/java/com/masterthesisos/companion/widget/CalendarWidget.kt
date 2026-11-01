package com.masterthesisos.companion.widget

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.LocalSize
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.appWidgetBackground
import androidx.glance.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.text.Text
import com.masterthesisos.companion.data.CalendarItem
import com.masterthesisos.companion.data.SourceState
import com.masterthesisos.companion.data.WidgetModel
import com.masterthesisos.companion.data.WidgetRepository

class CalendarWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Exact

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val model = WidgetRepository.get(context).model()
        provideContent { CalendarContent(context, model) }
    }
}

class CalendarWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = CalendarWidget()
}

@Composable
private fun CalendarContent(context: Context, model: WidgetModel) {
    val open = openAction(context, "calendar")
    val maxItems = if (LocalSize.current.height < 150.dp) 2 else 4
    Column(
        modifier = GlanceModifier.fillMaxSize().appWidgetBackground().background(Bg).cornerRadius(22.dp).padding(14.dp),
    ) {
        WidgetHeader("오늘의 일정", model, open)
        Spacer(GlanceModifier.height(8.dp))
        val snapshot = model.snapshot
        when {
            !model.signedIn -> Message("로그인 후 일정 확인", open)
            snapshot == null -> Message(if (model.error != null) "일정을 불러오지 못함" else "불러오는 중…", open)
            else -> when (snapshot.calendarState) {
                SourceState.UNCONFIGURED -> Message("캘린더가 설정되지 않음", open)
                SourceState.ERROR -> Message("일정을 불러오지 못함", open)
                SourceState.EMPTY -> Message("오늘 일정 없음", open)
                SourceState.READY -> {
                    snapshot.events.take(maxItems).forEach { EventRow(it, snapshot.date, open) }
                    val rest = snapshot.events.size - maxItems
                    if (rest > 0) Text("+${rest}개", style = style(11, TextSub), modifier = GlanceModifier.clickable(open))
                }
            }
        }
        Spacer(GlanceModifier.defaultWeight())
        Footer(model)
    }
}

@Composable
private fun Message(text: String, open: androidx.glance.action.Action) {
    Text(text, style = style(13, TextSub), modifier = GlanceModifier.fillMaxWidth().clickable(open))
}

@Composable
private fun EventRow(item: CalendarItem, today: String, open: androidx.glance.action.Action) {
    val time = when {
        item.allDay -> "종일"
        item.start.length >= 16 -> item.start.substring(11, 16)
        else -> ""
    }
    val day = if (item.start.take(10) != today && item.start.length >= 10) item.start.substring(5, 10).replace('-', '/') + " " else ""
    Row(modifier = GlanceModifier.fillMaxWidth().padding(vertical = 3.dp).clickable(open)) {
        Text(day + time, style = style(12, androidx.compose.ui.graphics.Color(0xFF5CC8B8), true), maxLines = 1)
        Spacer(GlanceModifier.width(8.dp))
        Text(item.title.ifBlank { "(제목 없음)" }, style = style(13), maxLines = 1)
    }
}
