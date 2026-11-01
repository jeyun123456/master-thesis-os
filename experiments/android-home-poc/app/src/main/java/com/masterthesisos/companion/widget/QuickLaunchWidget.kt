package com.masterthesisos.companion.widget

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.action.Action
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.appWidgetBackground
import androidx.glance.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.text.Text

/** Reads no personal data, so it is safe to leave on any home screen. */
class QuickLaunchWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        provideContent { QuickLaunchContent(context) }
    }
}

class QuickLaunchWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = QuickLaunchWidget()
}

@Composable
private fun QuickLaunchContent(context: Context) {
    Column(
        modifier = GlanceModifier.fillMaxSize().appWidgetBackground().background(Bg).cornerRadius(22.dp).padding(12.dp),
    ) {
        Text("Chocomint Lab", style = style(13, TextMain, true))
        Spacer(GlanceModifier.height(6.dp))
        Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            QuickButton("홈", openAction(context, "home"), GlanceModifier.defaultWeight())
            Spacer(GlanceModifier.width(8.dp))
            QuickButton("AI 인박스", openAction(context, "inbox"), GlanceModifier.defaultWeight())
            Spacer(GlanceModifier.width(8.dp))
            QuickButton("플래너", openAction(context, "planner"), GlanceModifier.defaultWeight())
        }
    }
}

@Composable
private fun QuickButton(label: String, action: Action, modifier: GlanceModifier) {
    Box(
        modifier = modifier.background(Surface).cornerRadius(12.dp).padding(vertical = 10.dp).clickable(action),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, style = style(12, Accent, true), maxLines = 1)
    }
}
