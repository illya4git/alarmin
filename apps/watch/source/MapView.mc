import Toybox.Communications;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;
import Toybox.Time;
import Toybox.Timer;
import Toybox.WatchUi;

// Page 2 (plan §3.5): minimap. Oblasts filled from /v1/all (polled every 15 s while visible),
// the selected region outlined in white. Each region is a pre-rasterized glyph of the Map font
// (packages/shared/scripts/gen-map.ts) drawn in its level's colour: about 55 drawText calls and no
// per-point work. The font is loaded on show and released on hide.
class MapView extends WatchUi.View {
    const POLL_MS = 15000;
    // Older data is drawn as unknown (same rule as the status page).
    const MAX_AGE_S = Status.MAX_AGE_S;

    private var _timer as Timer.Timer?;
    private var _inFlight as Boolean = false;
    private var _font as WatchUi.FontResource?;
    // Last /v1/all "m" string (one digit per region, map order), or null.
    private var _map as String?;
    private var _stale as Boolean = false;
    private var _fetchedAt as Number = 0;
    private var _error as Number = 0;

    function initialize() {
        View.initialize();
    }

    function onShow() as Void {
        _font = WatchUi.loadResource(Rez.Fonts.Map) as WatchUi.FontResource;
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
        _font = null;
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
        var m = data instanceof Dictionary ? data["m"] : null;
        if (code == 200 && data instanceof Dictionary && m instanceof String) {
            var d = data as Dictionary<String, Object or Null>;
            _map = m;
            _stale = Status.toNumber(d["x"], 0) == 1;
            _fetchedAt = Time.now().value() - Status.toNumber(d["a"], 0);
            _error = 0;
        } else {
            _error = code;
        }
        WatchUi.requestUpdate();
    }

    // Level per map index, or null when there's nothing current to show.
    private function levels() as Array<Char>? {
        if (_map == null || _stale || Time.now().value() - _fetchedAt > MAX_AGE_S) {
            return null;
        }
        return (_map as String).toCharArray();
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        var w = dc.getWidth();
        var h = dc.getHeight();
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

        var font = _font;
        var lv = levels();
        var counts = [0, 0, 0] as Array<Number>;
        if (lv != null) {
            for (var i = 0; i < lv.size(); i++) {
                var l = lv[i].toNumber() - 48;
                if (l >= 0 && l <= 2) {
                    counts[l] += 1;
                }
            }
        }

        if (font != null) {
            var selected = Regions.indexOf(Settings.oblastId());
            var just = Graphics.TEXT_JUSTIFY_LEFT;
            var sel = -1;
            for (var k = 0; k < MapData.COUNT; k++) {
                var idx = MapData.IDX[k];
                var level = levelAt(lv, idx);
                var x = MapData.X[k];
                var y = MapData.Y[k];
                if (level >= 0) {
                    dc.setColor(Ui.background(level), Graphics.COLOR_TRANSPARENT);
                    dc.drawText(x, y, font, (65 + k).toChar().toString(), just);
                }
                // Borders: black between coloured regions, white around unknown ones.
                dc.setColor(level >= 0 ? Graphics.COLOR_BLACK : Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
                dc.drawText(x, y, font, (97 + k).toChar().toString(), just);
                if (idx == selected) {
                    sel = k;
                }
            }
            // Selected region on top: the outline drawn five times, one pixel apart, reads as ~3 px.
            if (sel >= 0) {
                var ring = (97 + sel).toChar().toString();
                var x = MapData.X[sel];
                var y = MapData.Y[sel];
                dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
                dc.drawText(x, y, font, ring, just);
                dc.drawText(x - 1, y, font, ring, just);
                dc.drawText(x + 1, y, font, ring, just);
                dc.drawText(x, y - 1, font, ring, just);
                dc.drawText(x, y + 1, font, ring, just);
            }
            // Cities too small to fill.
            for (var i = 0; i < MapData.DOTS.size(); i++) {
                var dot = MapData.DOTS[i];
                var level = levelAt(lv, dot[0]);
                dc.setColor(level >= 0 ? Ui.background(level) : Graphics.COLOR_BLACK, Graphics.COLOR_TRANSPARENT);
                dc.fillCircle(dot[1], dot[2], 4);
                dc.setColor(level >= 0 ? Graphics.COLOR_BLACK : Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
                dc.drawCircle(dot[1], dot[2], 4);
                if (dot[0] == selected) {
                    dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
                    dc.setPenWidth(2);
                    dc.drawCircle(dot[1], dot[2], 7);
                    dc.setPenWidth(1);
                }
            }
        }

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 88 / 100, Graphics.FONT_XTINY, footer(lv, counts),
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    private function footer(lv as Array<Char>?, counts as Array<Number>) as String {
        if (_error != 0) {
            return Ui.errorText(_error);
        } else if (_map == null) {
            return "Loading...";
        } else if (lv == null) {
            return "Source down";
        } else if (counts[Levels.RED] + counts[Levels.YELLOW] == 0) {
            return "All clear";
        }
        return counts[Levels.RED] + " red  " + counts[Levels.YELLOW] + " yellow";
    }

    // Levels.* for a map index, or -1 if unknown.
    private function levelAt(lv as Array<Char>?, idx as Number) as Number {
        if (lv == null || idx >= lv.size()) {
            return -1;
        }
        var l = lv[idx].toNumber() - 48;
        return (l >= 0 && l <= 2) ? l : -1;
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
