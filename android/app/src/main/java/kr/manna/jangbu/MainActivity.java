package kr.manna.jangbu;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.service.notification.NotificationListenerService;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** 만나장부 화면: 앱 안의 웹 화면(assets/www)을 띄우고, 알림 상자·설정·백업을 연결한다. */
public class MainActivity extends Activity {
    private static final int REQ_EXPORT = 11;
    private static final int REQ_IMPORT = 12;

    private WebView web;
    private String pendingExport;
    private boolean receiverOn;

    private final BroadcastReceiver newNotif = new BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent i) {
            js("window.onNativeNew && window.onNativeNew()");
        }
    };

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.parseColor("#F5F2EC"));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            getWindow().getDecorView().setSystemUiVisibility(android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        }

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setTextZoom(100);
        web.addJavascriptInterface(new Bridge(), "Android");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if ("file".equals(u.getScheme())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }
        });
        setContentView(web);
        web.loadUrl("file:///android_asset/www/index.html");
    }

    @Override
    protected void onResume() {
        super.onResume();
        IntentFilter f = new IntentFilter(MannaListener.ACTION_NEW);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(newNotif, f, Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(newNotif, f);
        receiverOn = true;
        // 알림 읽기가 꺼져 있었다면 다시 연결 요청
        if (listenerEnabled() && Build.VERSION.SDK_INT >= 24) {
            try { NotificationListenerService.requestRebind(new ComponentName(this, MannaListener.class)); } catch (Exception ignored) { }
        }
        js("window.onNativeResume && window.onNativeResume()");
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (receiverOn) { try { unregisterReceiver(newNotif); } catch (Exception ignored) { } receiverOn = false; }
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("(window.onNativeBack && window.onNativeBack()) ? 'y' : 'n'", v -> {
            if (v == null || !v.contains("y")) MainActivity.super.onBackPressed();
        });
    }

    private void js(String code) {
        runOnUiThread(() -> { if (web != null) web.evaluateJavascript(code, null); });
    }

    private boolean listenerEnabled() {
        String flat = Settings.Secure.getString(getContentResolver(), "enabled_notification_listeners");
        return flat != null && flat.contains(getPackageName());
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (res != RESULT_OK || data == null || data.getData() == null) return;
        Uri uri = data.getData();
        if (req == REQ_EXPORT && pendingExport != null) {
            try (OutputStream os = getContentResolver().openOutputStream(uri)) {
                os.write(pendingExport.getBytes(StandardCharsets.UTF_8));
                js("window.onNativeToast && window.onNativeToast('백업 파일을 저장했어')");
            } catch (Exception e) {
                js("window.onNativeToast && window.onNativeToast('백업 저장에 실패했어')");
            }
            pendingExport = null;
        } else if (req == REQ_IMPORT) {
            try (InputStream is = getContentResolver().openInputStream(uri);
                 BufferedReader br = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = br.readLine()) != null) sb.append(line).append('\n');
                js("window.onBackupLoaded && window.onBackupLoaded(" + JSONObject.quote(sb.toString()) + ")");
            } catch (Exception e) {
                js("window.onNativeToast && window.onNativeToast('백업 파일을 읽지 못했어')");
            }
        }
    }

    /** 자바스크립트에서 window.Android.xxx() 로 부르는 기능들 */
    private class Bridge {
        @JavascriptInterface
        public String drain() { return NotifQueue.drain(MainActivity.this); }

        @JavascriptInterface
        public boolean listenerEnabled() { return MainActivity.this.listenerEnabled(); }

        @JavascriptInterface
        public void openListenerSettings() {
            runOnUiThread(() -> {
                try { startActivity(new Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS")); }
                catch (Exception e) { startActivity(new Intent(Settings.ACTION_SETTINGS)); }
            });
        }

        @JavascriptInterface
        public boolean batteryOk() {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            return pm != null && pm.isIgnoringBatteryOptimizations(getPackageName());
        }

        @JavascriptInterface
        public void openBatterySettings() {
            runOnUiThread(() -> {
                try {
                    Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName()));
                    startActivity(i);
                } catch (Exception e) {
                    try { startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)); } catch (Exception ignored) { }
                }
            });
        }

        @JavascriptInterface
        public void exportBackup(String json, String name) {
            pendingExport = json;
            runOnUiThread(() -> {
                Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("application/json");
                i.putExtra(Intent.EXTRA_TITLE, name);
                startActivityForResult(i, REQ_EXPORT);
            });
        }

        @JavascriptInterface
        public void importBackup() {
            runOnUiThread(() -> {
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                startActivityForResult(i, REQ_IMPORT);
            });
        }

        @JavascriptInterface
        public String version() {
            try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; }
            catch (Exception e) { return "?"; }
        }
    }
}
