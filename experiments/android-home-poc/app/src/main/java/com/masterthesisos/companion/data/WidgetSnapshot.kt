package com.masterthesisos.companion.data

import org.json.JSONArray
import org.json.JSONObject

enum class SourceState { READY, EMPTY, UNCONFIGURED, ERROR;
    companion object {
        fun parse(value: String?) = when (value) {
            "ready" -> READY
            "empty" -> EMPTY
            "unconfigured" -> UNCONFIGURED
            else -> ERROR
        }
    }
}

data class CalendarItem(val id: String, val title: String, val start: String, val allDay: Boolean, val location: String)

data class TaskItem(val id: String, val title: String, val dueDate: String?, val isToday: Boolean, val version: Int)

data class WidgetSnapshot(
    val date: String,
    val calendarState: SourceState,
    val events: List<CalendarItem>,
    val tasksState: SourceState,
    val tasks: List<TaskItem>,
    val openCount: Int,
    val overdueCount: Int,
    val focusCount: Int,
    val doneTodayCount: Int,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("date", date)
        .put("calendarState", calendarState.name)
        .put("events", JSONArray(events.map {
            JSONObject().put("id", it.id).put("title", it.title).put("start", it.start).put("allDay", it.allDay).put("location", it.location)
        }))
        .put("tasksState", tasksState.name)
        .put("tasks", JSONArray(tasks.map {
            JSONObject().put("id", it.id).put("title", it.title).put("dueDate", it.dueDate ?: JSONObject.NULL)
                .put("isToday", it.isToday).put("version", it.version)
        }))
        .put("openCount", openCount).put("overdueCount", overdueCount)
        .put("focusCount", focusCount).put("doneTodayCount", doneTodayCount)

    companion object {
        /** Parses the `/api/mobile/widget` response. Throws on a malformed body so it is never promoted to cache. */
        fun fromApi(json: JSONObject): WidgetSnapshot {
            require(json.optInt("schemaVersion") == 1) { "unsupported schema" }
            val calendar = json.getJSONObject("calendar")
            val tasks = json.getJSONObject("tasks")
            return build(
                json.getString("date"),
                SourceState.parse(calendar.optString("state")), calendar.optJSONArray("events"),
                SourceState.parse(tasks.optString("state")), tasks.optJSONArray("items"), tasks,
            )
        }

        fun fromCache(json: JSONObject): WidgetSnapshot = build(
            json.getString("date"),
            SourceState.valueOf(json.getString("calendarState")), json.optJSONArray("events"),
            SourceState.valueOf(json.getString("tasksState")), json.optJSONArray("tasks"), json,
        )

        private fun build(
            date: String, calState: SourceState, events: JSONArray?, taskState: SourceState, tasks: JSONArray?, counts: JSONObject,
        ) = WidgetSnapshot(
            date = date,
            calendarState = calState,
            events = events.objects().map {
                CalendarItem(it.getString("id"), it.optString("title"), it.getString("start"), it.optBoolean("allDay"), it.optString("location"))
            },
            tasksState = taskState,
            tasks = tasks.objects().map {
                TaskItem(it.getString("id"), it.optString("title"), it.optString("dueDate").takeIf { due -> due.isNotEmpty() && due != "null" },
                    it.optBoolean("isToday"), it.getInt("version"))
            },
            openCount = counts.optInt("openCount"),
            overdueCount = counts.optInt("overdueCount"),
            focusCount = counts.optInt("focusCount"),
            doneTodayCount = counts.optInt("doneTodayCount"),
        )

        private fun JSONArray?.objects(): List<JSONObject> = if (this == null) emptyList() else (0 until length()).map { getJSONObject(it) }
    }
}
