package kr.manna.jangbu;

import android.app.Notification;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.os.Parcelable;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import java.util.regex.Pattern;

/**
 * 폰에 오는 알림 중 "돈 알림"처럼 보이는 것만 골라 상자(NotifQueue)에 넣는다.
 * 금액(…원/USD)과 거래 단어가 둘 다 있어야 하므로, 일반 대화·광고 대부분은 아예 저장되지 않는다.
 * 저장된 내용은 이 폰 안에만 있고, 어디로도 보내지 않는다.
 */
public class MannaListener extends NotificationListenerService {
    static final String ACTION_NEW = "kr.manna.jangbu.NEW";
    private static final Pattern MONEY = Pattern.compile("\\d[\\d,]*\\s*원|USD");
    private static final Pattern WORDS = Pattern.compile("승인|취소|입금|출금|결제|이체|송금|사용|보냈|받았|환불");

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        try {
            String pkg = sbn.getPackageName();
            if (getPackageName().equals(pkg)) return;
            Notification n = sbn.getNotification();
            if (n == null || (n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;
            Bundle ex = n.extras;
            if (ex == null) return;

            String title = str(ex.getCharSequence(Notification.EXTRA_TITLE));
            String text = str(ex.getCharSequence(Notification.EXTRA_BIG_TEXT));
            if (text.isEmpty()) text = str(ex.getCharSequence(Notification.EXTRA_TEXT));

            // 메시지 앱(대화형 알림): 가장 최근 메시지 한 건
            Parcelable[] msgs = ex.getParcelableArray(Notification.EXTRA_MESSAGES);
            if (msgs != null && msgs.length > 0 && msgs[msgs.length - 1] instanceof Bundle) {
                CharSequence t = ((Bundle) msgs[msgs.length - 1]).getCharSequence("text");
                if (t != null && t.length() > 0) text = t.toString();
            }
            // 여러 줄 묶음 알림
            if (text.isEmpty()) {
                CharSequence[] lines = ex.getCharSequenceArray(Notification.EXTRA_TEXT_LINES);
                if (lines != null) {
                    StringBuilder sb = new StringBuilder();
                    for (CharSequence l : lines) { if (sb.length() > 0) sb.append('\n'); sb.append(l); }
                    text = sb.toString();
                }
            }

            String blob = title + "\n" + text;
            if (!MONEY.matcher(blob).find() || !WORDS.matcher(blob).find()) return;

            NotifQueue.add(this, sbn.getPostTime(), label(pkg), pkg, title, text);
            Intent i = new Intent(ACTION_NEW);
            i.setPackage(getPackageName());
            sendBroadcast(i);
        } catch (Exception ignored) {
        }
    }

    private String label(String pkg) {
        try {
            PackageManager pm = getPackageManager();
            ApplicationInfo ai = pm.getApplicationInfo(pkg, 0);
            return String.valueOf(pm.getApplicationLabel(ai));
        } catch (Exception e) {
            return pkg;
        }
    }

    private static String str(CharSequence c) {
        return c == null ? "" : c.toString().trim();
    }
}
