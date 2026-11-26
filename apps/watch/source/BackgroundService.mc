import Toybox.Application;
import Toybox.Background;
import Toybox.Communications;
import Toybox.Lang;
import Toybox.System;

// Runs every 5 minutes (the platform minimum) while the widget is closed: fetches the
// selected region's status, stores it, and asks to open the app when the colour changed
// (plan D6). The dialog appears only after Background.exit().
(:background)
class BackgroundService extends System.ServiceDelegate {
    private var _regionId as Number = 0;

    function initialize() {
        ServiceDelegate.initialize();
    }

    function onTemporalEvent() as Void {
        _regionId = Settings.regionId();
        if (!System.getDeviceSettings().phoneConnected) {
            Status.saveError(_regionId, Status.ERR_NO_PHONE);
            Background.exit(null);
            return;
        }
        Communications.makeWebRequest(Settings.statusUrl(_regionId), null, Settings.requestOptions(),
            method(:onResponse));
    }

    function onResponse(code as Number, data as Dictionary or String or Null) as Void {
        if (code != 200 || !(data instanceof Dictionary)) {
            Status.saveError(_regionId, code);
            Background.exit(null);
            return;
        }

        // Last level we showed for this region (raw, regardless of age), before overwriting it.
        var prev = Status.load();
        var prevLevel = prev["r"] == _regionId ? prev["l"] : null;

        var d = data as Dictionary<String, Object or Null>;
        Status.saveSuccess(_regionId, d);
        var level = Status.toNumber(d["l"], Status.UNKNOWN);
        var stale = Status.toNumber(d["x"], 0) == 1;

        if (prevLevel != null && prevLevel != Status.UNKNOWN && level != Status.UNKNOWN && level != prevLevel
                && !stale && Settings.alarmEnabled(level)) {
            Status.setPendingWake(level);
            Background.requestApplicationWake(message(level, Status.toNumber(d["f"], 0)));
        }
        Background.exit(true);
    }

    // Short, most important word first; the FR55 dialog wraps at ~14 characters.
    private function message(level as Number, flags as Number) as String {
        var head = "CLEAR";
        if (level == Levels.RED) {
            head = "AIR ALERT";
        } else if (level == Levels.YELLOW) {
            head = (flags & Levels.FLAG_OWN_YELLOW) != 0 ? "THREAT" : "PARTIAL";
        }
        return head + ": " + Settings.regionName();
    }
}
