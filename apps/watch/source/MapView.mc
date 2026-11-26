import Toybox.Communications;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;
import Toybox.Timer;
import Toybox.WatchUi;

// Page 2 (plan §3.5). Placeholder until the minimap (Phase 7): polls /v1/all while
// visible and shows how many regions are at each level. Nothing is stored.
class MapView extends WatchUi.View {
    const POLL_MS = 15000;

    private var _timer as Timer.Timer?;
    private var _inFlight as Boolean = false;
    // Last /v1/all "m" string (one digit per region, map order), or null.
    private var _map as String?;
    private var _error as Number = 0;

    function initialize() {
        View.initialize();
    }

    function onShow() as Void {
        fetch();
        var timer = new Timer.Timer();
        timer.start(method(:fetch), POLL_MS, true);
        _timer = timer;
    }

    function onHide() as Void {
        if (_timer != null) {
            _timer.stop();
            _timer = null;
        }
    }

    function fetch() as Void {
        if (_inFlight) {
            return;
        }
        if (!System.getDeviceSettings().phoneConnected) {
            _error = Status.ERR_NO_PHONE;
            WatchUi.requestUpdate();
            return;
        }
        _inFlight = true;
        Communications.makeWebRequest(Settings.proxyUrl() + "/v1/all", null, Settings.requestOptions(),
            method(:onResponse));
    }

    function onResponse(code as Number, data as Dictionary or String or Null) as Void {
        _inFlight = false;
        var m = data instanceof Dictionary ? (data as Dictionary<String, Object or Null>)["m"] : null;
        if (code == 200 && m instanceof String) {
            _map = m;
            _error = 0;
        } else {
            _error = code;
        }
        WatchUi.requestUpdate();
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        var w = dc.getWidth();
        var h = dc.getHeight();
        var cx = w / 2;
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

        dc.drawText(cx, h * 14 / 100, Graphics.FONT_SMALL, "Ukraine", Graphics.TEXT_JUSTIFY_CENTER);

        if (_map != null) {
            var counts = [0, 0, 0] as Array<Number>;
            var m = _map as String;
            var chars = m.toCharArray();
            for (var i = 0; i < chars.size(); i++) {
                var l = chars[i].toNumber() - '0'.toNumber();
                if (l >= 0 && l <= 2) {
                    counts[l] += 1;
                }
            }
            var rowH = dc.getFontHeight(Graphics.FONT_MEDIUM);
            var top = h * 34 / 100;
            var rows = [[Levels.RED, "red"], [Levels.YELLOW, "yellow"], [Levels.GREEN, "clear"]];
            for (var i = 0; i < rows.size(); i++) {
                var level = rows[i][0] as Number;
                dc.setColor(Ui.background(level), Graphics.COLOR_TRANSPARENT);
                dc.drawText(cx, top + i * rowH, Graphics.FONT_MEDIUM, counts[level] + " " + rows[i][1],
                    Graphics.TEXT_JUSTIFY_CENTER);
            }
        }

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        var footer = _error != 0 ? Ui.errorText(_error) : _map == null ? "Loading..." : "Map coming soon";
        dc.drawText(cx, h * 84 / 100, Graphics.FONT_XTINY, footer,
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }
}

class MapDelegate extends WatchUi.BehaviorDelegate {
    function initialize() {
        BehaviorDelegate.initialize();
    }

    // UP → status page.
    function onPreviousPage() as Boolean {
        WatchUi.switchToView(new MainView(), new MainDelegate(), WatchUi.SLIDE_DOWN);
        return true;
    }

    // DOWN → menu (page 3); BACK or UP from its first item returns here.
    function onNextPage() as Boolean {
        WatchUi.pushView(new MainMenu(), new MainMenuDelegate(), WatchUi.SLIDE_UP);
        return true;
    }
}
