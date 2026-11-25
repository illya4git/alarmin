import Toybox.Attention;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Timer;
import Toybox.WatchUi;

// Full-screen status. Polls the proxy every 10 s while visible.
class MainView extends WatchUi.View {
    const POLL_MS = 10000;

    private var _request as StatusRequest = new StatusRequest();
    private var _timer as Timer.Timer?;

    function initialize() {
        View.initialize();
    }

    function onShow() as Void {
        vibrateForWake(Status.takePendingWake());
        _request.fetch();
        var timer = new Timer.Timer();
        timer.start(method(:onTick), POLL_MS, true);
        _timer = timer;
    }

    function onHide() as Void {
        if (_timer != null) {
            _timer.stop();
            _timer = null;
        }
    }

    function onTick() as Void {
        _request.fetch();
    }

    // Opened from a wake prompt: a level-specific pattern, recognisable without looking.
    // Red: three long. Yellow: two short. Clear: one short.
    private function vibrateForWake(level as Number) as Void {
        if (level == Status.UNKNOWN || !(Attention has :vibrate)) {
            return;
        }
        var pattern = [] as Array<Attention.VibeProfile>;
        var count = level == Levels.RED ? 3 : level == Levels.YELLOW ? 2 : 1;
        var onMs = level == Levels.RED ? 600 : 200;
        for (var i = 0; i < count; i++) {
            if (i > 0) {
                pattern.add(new Attention.VibeProfile(0, 250));
            }
            pattern.add(new Attention.VibeProfile(100, onMs));
        }
        Attention.vibrate(pattern);
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        var st = Status.current();
        var level = Status.displayLevel(st);
        var flags = st["f"] != null ? st["f"] as Number : 0;
        var w = dc.getWidth();
        var h = dc.getHeight();
        var cx = w / 2;
        var fg = Ui.foreground(level);

        dc.setColor(fg, Ui.background(level));
        dc.clear();
        dc.setColor(fg, Graphics.COLOR_TRANSPARENT);

        // Region name
        dc.drawText(cx, h * 14 / 100, Graphics.FONT_SMALL, Regions.nameOf(Settings.regionId()),
            Graphics.TEXT_JUSTIFY_CENTER);

        // Headline
        dc.drawText(cx, h * 37 / 100, Graphics.FONT_LARGE, Ui.headline(level, flags),
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        // Since / extra flags
        var detail = "";
        if (level != Status.UNKNOWN && st["t"] != null) {
            detail = Ui.since(st["t"] as Number);
        }
        if ((flags & (Levels.FLAG_ARTILLERY | Levels.FLAG_URBAN_FIGHTS)) != 0) {
            detail += (detail.length() > 0 ? "\n" : "") + "+ shelling";
        }
        if (detail.length() > 0) {
            dc.drawText(cx, h * 49 / 100, Graphics.FONT_TINY, detail, Graphics.TEXT_JUSTIFY_CENTER);
        }

        // Footer: freshness or error, at most two short lines (the round screen narrows at the bottom)
        dc.drawText(cx, h * 79 / 100, Graphics.FONT_XTINY, footer(st),
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    private function footer(st as Dictionary<String, Number>) as String {
        var e = st["e"];
        var age = Status.dataAge(st);
        if (e != null && e != 0) {
            return Ui.errorText(e) + (age >= 0 ? "\ndata " + Ui.age(age) : "");
        }
        if (age < 0) {
            return "Loading...";
        }
        if (st["x"] == 1) {
            return "Source down\n" + Ui.age(age);
        }
        return "Updated " + Ui.age(age);
    }
}

class MainDelegate extends WatchUi.BehaviorDelegate {
    function initialize() {
        BehaviorDelegate.initialize();
    }

    // START or long-press UP opens the region picker.
    function onSelect() as Boolean {
        return openPicker();
    }

    function onMenu() as Boolean {
        return openPicker();
    }

    private function openPicker() as Boolean {
        WatchUi.pushView(new RegionPicker(), new RegionPickerDelegate(), WatchUi.SLIDE_LEFT);
        return true;
    }
}
