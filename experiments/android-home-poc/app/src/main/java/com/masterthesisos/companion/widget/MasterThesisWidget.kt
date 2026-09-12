package com.masterthesisos.companion.widget

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.appWidgetBackground
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
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import androidx.glance.cornerRadius
import com.masterthesisos.companion.OpenMasterThesisActivity

class MasterThesisWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        provideContent {
            MasterThesisWidgetContent()
        }
    }
}

class MasterThesisWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = MasterThesisWidget()
}

@Composable
private fun MasterThesisWidgetContent() {
    val openMasterThesisOs = actionStartActivity<OpenMasterThesisActivity>()

    Column(
        modifier = GlanceModifier
            .fillMaxSize()
            .appWidgetBackground()
            .background(Color(0xFF101319))
            .cornerRadius(24.dp)
            .clickable(openMasterThesisOs)
            .padding(16.dp),
    ) {
        Header()
        Spacer(GlanceModifier.height(12.dp))
        InfoBlock(
            title = "오늘 할 일",
            first = "분해 결과 해석 메모 정리",
            second = "중간발표 피드백 반영",
        )
        Spacer(GlanceModifier.height(10.dp))
        InfoBlock(
            title = "가까운 일정",
            first = "다음 연구 일정 확인",
            second = "Google Calendar 연동 예정",
        )
        Spacer(GlanceModifier.height(10.dp))
        InfoBlock(
            title = "연구 진행",
            first = "BLUEBIRD · 결과 해석 단계",
            second = "METHOD_B · 기준연도 2015",
        )
        Spacer(GlanceModifier.height(12.dp))
        OpenRow()
    }
}

@Composable
private fun Header() {
    Row(modifier = GlanceModifier.fillMaxWidth()) {
        Text(
            text = "Master Thesis OS",
            style = TextStyle(
                color = ColorProvider(Color(0xFFF7F8FA)),
                fontSize = 17.sp,
                fontWeight = FontWeight.Bold,
            ),
        )
        Spacer(GlanceModifier.width(8.dp))
        Text(
            text = "MOCK",
            style = TextStyle(
                color = ColorProvider(Color(0xFF8EA7FF)),
                fontSize = 11.sp,
                fontWeight = FontWeight.Medium,
            ),
        )
    }
}

@Composable
private fun InfoBlock(title: String, first: String, second: String) {
    Column(
        modifier = GlanceModifier
            .fillMaxWidth()
            .background(Color(0xFF181D26))
            .cornerRadius(14.dp)
            .padding(horizontal = 12.dp, vertical = 9.dp),
    ) {
        Text(
            text = title,
            style = TextStyle(
                color = ColorProvider(Color(0xFFAAB2C2)),
                fontSize = 11.sp,
                fontWeight = FontWeight.Medium,
            ),
            maxLines = 1,
        )
        Spacer(GlanceModifier.height(3.dp))
        Text(
            text = first,
            style = TextStyle(
                color = ColorProvider(Color(0xFFF2F4F8)),
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
            ),
            maxLines = 1,
        )
        Text(
            text = second,
            style = TextStyle(
                color = ColorProvider(Color(0xFFB9C0CD)),
                fontSize = 11.sp,
            ),
            maxLines = 1,
        )
    }
}

@Composable
private fun OpenRow() {
    Row(
        modifier = GlanceModifier
            .fillMaxWidth()
            .background(Color(0xFF26396F))
            .cornerRadius(12.dp)
            .padding(horizontal = 12.dp, vertical = 9.dp),
    ) {
        Text(
            text = "Master Thesis OS 열기",
            style = TextStyle(
                color = ColorProvider(Color(0xFFF3F6FF)),
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
            ),
        )
        Spacer(GlanceModifier.width(6.dp))
        Text(
            text = "↗",
            style = TextStyle(
                color = ColorProvider(Color(0xFFAFC2FF)),
                fontSize = 12.sp,
            ),
        )
    }
}
