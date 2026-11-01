package com.masterthesisos.companion.sync

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.masterthesisos.companion.data.WidgetRepository
import java.util.concurrent.TimeUnit

class WidgetRefreshWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val repo = WidgetRepository.get(applicationContext)
        if (!repo.signedIn()) return Result.success()
        // refresh() records offline/failed state itself; the periodic schedule is the retry.
        repo.refresh()
        return Result.success()
    }

    companion object {
        private const val NAME = "chocomint-widget-refresh"

        /** Best effort at >= 15 minute intervals; Android may delay it (Doze, battery optimisation). */
        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<WidgetRefreshWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, request)
        }

        fun cancel(context: Context) = WorkManager.getInstance(context).cancelUniqueWork(NAME)
    }
}
