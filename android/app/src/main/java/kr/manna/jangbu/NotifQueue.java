package kr.manna.jangbu;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 받은 돈 알림을 앱이 열릴 때까지 폰 안에 잠깐 모아두는 상자.
 * 앱 화면(자바스크립트)이 drain()으로 꺼내 가서 해석·저장한다.
 */
final class NotifQueue {
    private static final String PREF = "manna_queue";
    private static final String KEY = "items";
    private static final int MAX = 1000;

    private NotifQueue() {}

    static synchronized void add(Context ctx, long time, String app, String pkg, String title, String text) {
        try {
            SharedPreferences sp = ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE);
            JSONArray arr = new JSONArray(sp.getString(KEY, "[]"));
            // 같은 알림이 10분 안에 다시 오면 무시 (알림 갱신 등)
            for (int i = Math.max(0, arr.length() - 30); i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                if (pkg.equals(o.optString("pkg")) && title.equals(o.optString("title"))
                        && text.equals(o.optString("text")) && Math.abs(time - o.optLong("time")) < 10 * 60 * 1000) {
                    return;
                }
            }
            JSONObject o = new JSONObject();
            o.put("time", time);
            o.put("app", app);
            o.put("pkg", pkg);
            o.put("title", title);
            o.put("text", text);
            arr.put(o);
            if (arr.length() > MAX) {
                JSONArray trimmed = new JSONArray();
                for (int i = arr.length() - MAX; i < arr.length(); i++) trimmed.put(arr.get(i));
                arr = trimmed;
            }
            sp.edit().putString(KEY, arr.toString()).apply();
        } catch (Exception ignored) {
        }
    }

    static synchronized String drain(Context ctx) {
        SharedPreferences sp = ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE);
        String s = sp.getString(KEY, "[]");
        sp.edit().putString(KEY, "[]").commit();
        return s;
    }

    static synchronized int size(Context ctx) {
        try {
            return new JSONArray(ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE).getString(KEY, "[]")).length();
        } catch (Exception e) {
            return 0;
        }
    }
}
