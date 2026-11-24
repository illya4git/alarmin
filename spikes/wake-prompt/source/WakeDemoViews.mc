import Toybox.Application;
import Toybox.Attention;
import Toybox.Background;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Time;
import Toybox.WatchUi;

class WakeDemoView extends WatchUi.View {
    function initialize() {
        View.initialize();
    }

    function onShow() as Void {
        // Opened from the wake prompt (or by hand): buzz, as the real app would.
        if (wakeIsArmed() && Attention has :vibrate) {
            Attention.vibrate([
                new Attention.VibeProfile(100, 400),
                new Attention.VibeProfile(0, 200),
                new Attention.VibeProfile(100, 400)
            ]);
        }
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        var armed = wakeIsArmed();
        var w = dc.getWidth();
        var h = dc.getHeight();
        var cx = w / 2;

        dc.setColor(Graphics.COLOR_BLACK, armed ? Graphics.COLOR_RED : Graphics.COLOR_GREEN);
        dc.clear();

        var runs = Application.Storage.getValue(KEY_RUNS);
        var lines = [
            "Wake Demo",
            armed ? "Prompts: ON" : "Prompts: OFF",
            "Every " + (WAKE_INTERVAL_S / 60) + " min",
            "Last run " + formatEpoch(Application.Storage.getValue(KEY_LAST_RUN)),
            "Runs: " + (runs instanceof Number ? runs : 0),
            "START: toggle"
        ];

        var font = Graphics.FONT_XTINY;
        var lineH = dc.getFontHeight(font) + 2;
        var y = (h - lines.size() * lineH) / 2;
        for (var i = 0; i < lines.size(); i++) {
            dc.drawText(cx, y + i * lineH, i == 0 ? Graphics.FONT_SMALL : font,
                lines[i], Graphics.TEXT_JUSTIFY_CENTER);
        }
    }
}

class WakeDemoDelegate extends WatchUi.BehaviorDelegate {
    function initialize() {
        BehaviorDelegate.initialize();
    }

    function onSelect() as Boolean {
        if (wakeIsArmed()) {
            Background.deleteTemporalEvent();
        } else {
            Background.registerForTemporalEvent(new Time.Duration(WAKE_INTERVAL_S));
        }
        WatchUi.requestUpdate();
        return true;
    }
}

(:glance)
class WakeDemoGlance extends WatchUi.GlanceView {
    function initialize() {
        GlanceView.initialize();
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        var armed = wakeIsArmed();
        dc.setColor(armed ? Graphics.COLOR_RED : Graphics.COLOR_GREEN, Graphics.COLOR_TRANSPARENT);
        dc.fillRectangle(0, 0, 8, dc.getHeight());
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        var text = "WAKE " + (armed ? "ON" : "OFF") + "\nlast " +
            formatEpoch(Application.Storage.getValue(KEY_LAST_RUN));
        dc.drawText(14, dc.getHeight() / 2, Graphics.FONT_GLANCE, text,
            Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
    }
}
