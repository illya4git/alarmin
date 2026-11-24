// Spike: what does Background.requestApplicationWake() look and feel like on the FR55?
// START toggles a 5-minute temporal event. Each event asks the user to open the widget.

import Toybox.Application;
import Toybox.Background;
import Toybox.Lang;
import Toybox.System;
import Toybox.Time;
import Toybox.WatchUi;

const KEY_LAST_RUN = "lastRun";   // epoch s of the last background run
const KEY_RUNS = "runs";          // number of background runs so far
const WAKE_INTERVAL_S = 300;      // platform minimum

(:background)
class WakeDemoApp extends Application.AppBase {
    function initialize() {
        AppBase.initialize();
    }

    function getInitialView() {
        return [new WakeDemoView(), new WakeDemoDelegate()];
    }

    (:glance)
    function getGlanceView() {
        return [new WakeDemoGlance()];
    }

    function getServiceDelegate() {
        return [new WakeDemoService()];
    }

    // Runs in the foreground process after the background task exits.
    function onBackgroundData(data) {
        if (data instanceof Number) {
            Application.Storage.setValue(KEY_LAST_RUN, data);
            var runs = Application.Storage.getValue(KEY_RUNS);
            Application.Storage.setValue(KEY_RUNS, (runs instanceof Number ? runs : 0) + 1);
        }
        WatchUi.requestUpdate();
    }
}

(:background)
class WakeDemoService extends System.ServiceDelegate {
    function initialize() {
        ServiceDelegate.initialize();
    }

    function onTemporalEvent() {
        // 255-byte limit; ASCII only here (FR55 has no Cyrillic glyphs).
        Background.requestApplicationWake("Kyivska: RED alert. Open Wake Demo?");
        // The dialog only appears after exit().
        Background.exit(Time.now().value());
    }
}

// Helpers shared by the views (not needed in the background process).
(:glance)
function wakeIsArmed() as Boolean {
    return Background.getTemporalEventRegisteredTime() != null;
}

(:glance)
function formatEpoch(value) as String {
    if (!(value instanceof Number)) {
        return "never";
    }
    var info = Time.Gregorian.info(new Time.Moment(value), Time.FORMAT_SHORT);
    return Lang.format("$1$:$2$:$3$", [
        info.hour.format("%02d"), info.min.format("%02d"), info.sec.format("%02d")
    ]);
}
