package com.masterthesisos.companion.widget

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.action.Action
import androidx.glance.action.ActionParameters
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.appWidgetBackground
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.text.Text
import com.masterthesisos.companion.data.SourceState
import com.masterthesisos.companion.data.TaskItem
import com.masterthesisos.companion.data.WidgetModel
import com.masterthesisos.companion.data.WidgetRepository
import java.util.Collections

private val TaskIdKey = ActionParameters.Key<String>("taskId")
private val TaskVersionKey = ActionParameters.Key<Int>("taskVersion")

class TodayTasksWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val model = WidgetRepository.get(context).model()
        provideContent { TasksContent(context, model) }
    }
}

class TodayTasksWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = TodayTasksWidget()
}

/** Completes one task online. Repeated taps on the same task are ignored while a request is in flight. */
class CompleteTaskAction : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        val id = parameters[TaskIdKey] ?: return
        val version = parameters[TaskVersionKey] ?: return
        if (!pending.add(id)) return
        try {
            updateAllWidgets(context) // show "처리 중"
            WidgetRepository.get(context).completeTask(TaskItem(id, "", null, false, version))
        } finally {
            pending.remove(id)
            updateAllWidgets(context)
        }
    }

    companion object {
        val pending: MutableSet<String> = Collections.synchronizedSet(mutableSetOf())
    }
}

@Composable
private fun TasksContent(context: Context, model: WidgetModel) {
    val planner = openAction(context, "planner")
    Column(
        modifier = GlanceModifier.fillMaxSize().appWidgetBackground().background(Bg).padding(14.dp),
    ) {
        WidgetHeader("오늘의 할 일", model, planner)
        val snapshot = model.snapshot
        if (model.signedIn && snapshot != null && snapshot.tasksState != SourceState.ERROR) {
            // Counts describe the server-defined open/overdue/done sets, not just the rows shown below.
            Text(
                "오늘 완료 ${snapshot.doneTodayCount} · 전체 진행 중 ${snapshot.openCount} · 기한 지남 ${snapshot.overdueCount}",
                style = style(10, TextSub), maxLines = 1,
            )
        }
        Spacer(GlanceModifier.height(8.dp))
        when {
            !model.signedIn -> Message("로그인 후 할 일 확인", planner)
            snapshot == null -> Message(if (model.error != null) "할 일을 불러오지 못함" else "불러오는 중…", planner)
            snapshot.tasksState == SourceState.ERROR -> Message("할 일을 불러오지 못함", planner)
            snapshot.tasks.isEmpty() -> Message("지금 집중할 할 일 없음", planner)
            else -> snapshot.tasks.forEach { TaskRow(it, snapshot.date, model.error != null, planner) }
        }
        Spacer(GlanceModifier.defaultWeight())
        Footer(model)
    }
}

@Composable
private fun Message(text: String, open: Action) {
    Text(text, style = style(13, TextSub), modifier = GlanceModifier.fillMaxWidth().clickable(open))
}

@Composable
private fun TaskRow(task: TaskItem, today: String, offline: Boolean, planner: Action) {
    val busy = task.id in CompleteTaskAction.pending
    val due = task.dueDate
    val dueText = when {
        due == null -> null
        due < today -> "기한 지남"
        due == today -> "오늘까지"
        else -> due.substring(5).replace('-', '/') + "까지"
    }
    Row(
        modifier = GlanceModifier.fillMaxWidth().padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val check = when {
            busy -> "…"
            offline -> "⊘"
            else -> "○"
        }
        val checkModifier = GlanceModifier.padding(end = 10.dp, top = 2.dp, bottom = 2.dp)
        Text(
            check,
            style = style(20, if (offline) Warn else Accent, true),
            modifier = if (busy || offline) checkModifier else checkModifier.clickable(
                actionRunCallback<CompleteTaskAction>(
                    androidx.glance.action.actionParametersOf(TaskIdKey to task.id, TaskVersionKey to task.version),
                ),
            ),
        )
        Column(modifier = GlanceModifier.defaultWeight().clickable(planner)) {
            Text(task.title.ifBlank { "(제목 없음)" }, style = style(13), maxLines = 1)
            val sub = when {
                busy -> "처리 중"
                offline -> "연결 필요"
                else -> dueText
            }
            if (sub != null) Text(sub, style = style(10, if (dueText == "기한 지남" && !busy) Warn else TextSub), maxLines = 1)
        }
    }
}
