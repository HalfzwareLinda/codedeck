package com.codedeck.backgroundrelay

import android.app.Activity
import android.content.Intent
import android.webkit.WebView
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@TauriPlugin
class BackgroundRelayPlugin(private val activity: Activity) : Plugin(activity) {

    @Command
    fun startService(invoke: Invoke) {
        val intent = Intent(activity, BridgeRelayService::class.java)
        ContextCompat.startForegroundService(activity, intent)
        val ret = JSObject()
        ret.put("success", true)
        invoke.resolve(ret)
    }

    @Command
    fun stopService(invoke: Invoke) {
        val intent = Intent(activity, BridgeRelayService::class.java)
        activity.stopService(intent)
        val ret = JSObject()
        ret.put("success", true)
        invoke.resolve(ret)
    }

    @Command
    fun isRunning(invoke: Invoke) {
        val ret = JSObject()
        ret.put("running", BridgeRelayService.isRunning)
        invoke.resolve(ret)
    }
}
