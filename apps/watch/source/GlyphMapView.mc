import Toybox.Communications;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;
import Toybox.Time;
import Toybox.Timer;
import Toybox.WatchUi;

// Shared by the country map (MapView) and the zoomed oblast (ZoomView): polls a proxy endpoint that
// returns one level digit per shape ("m"), and draws shapes as tinted glyphs of a map font
// (packages/shared/scripts/lib/raster.ts): fill 'A'+k in the level's colour, outline 'a'+k.
class GlyphMapView extends WatchUi.View {
    const POLL_MS = 15000;

    private var _timer as Timer.Timer?;
    private var _inFlight as Boolean = false;
    // Last "m" string, or null.
    protected var _map as String?;
    protected var _stale as Boolean = false;
    protected var _fetchedAt as Number = 0;
    protected var _error as Number = 0;

    function initialize() {
        View.initialize();
    }

    // Endpoint path, e.g. "/v1/all".
    function path() as String {
        return "";
    }

    function startPolling() as Void {
        fetch();
        var timer = new Timer.Timer();
        timer.start(method(:fetch), POLL_MS, true);
        _timer = timer;
    }

    function stopPolling() as Void {
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
        Communications.makeWebRequest(Settings.proxyUrl() + path(), null, Settings.requestOptions(),
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

    // Level digits while current (same age rule as the status page), else null.
    function digits() as Array<Char>? {
        if (_map == null || _stale || Time.now().value() - _fetchedAt > Status.MAX_AGE_S) {
            return null;
        }
        return (_map as String).toCharArray();
    }

    // Levels.* at a digit position, or -1 if unknown.
    function levelAt(lv as Array<Char>?, idx as Number) as Number {
        if (lv == null || idx < 0 || idx >= lv.size()) {
            return -1;
        }
        var l = lv[idx].toNumber() - 48;
        return (l >= 0 && l <= 2) ? l : -1;
    }

    // Shape k: filled in its level's colour, black border; unknown ones just a white border.
    function drawShape(dc as Graphics.Dc, font as WatchUi.FontResource, k as Number, x as Number, y as Number,
            level as Number) as Void {
        if (level >= 0) {
            dc.setColor(Ui.background(level), Graphics.COLOR_TRANSPARENT);
            dc.drawText(x, y, font, (65 + k).toChar().toString(), Graphics.TEXT_JUSTIFY_LEFT);
        }
        dc.setColor(level >= 0 ? Graphics.COLOR_BLACK : Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(x, y, font, (97 + k).toChar().toString(), Graphics.TEXT_JUSTIFY_LEFT);
    }

    // The selected shape's outline in white, five times one pixel apart: reads as ~3 px.
    function drawSelected(dc as Graphics.Dc, font as WatchUi.FontResource, k as Number, x as Number,
            y as Number) as Void {
        var ring = (97 + k).toChar().toString();
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(x, y, font, ring, Graphics.TEXT_JUSTIFY_LEFT);
        dc.drawText(x - 1, y, font, ring, Graphics.TEXT_JUSTIFY_LEFT);
        dc.drawText(x + 1, y, font, ring, Graphics.TEXT_JUSTIFY_LEFT);
        dc.drawText(x, y - 1, font, ring, Graphics.TEXT_JUSTIFY_LEFT);
        dc.drawText(x, y + 1, font, ring, Graphics.TEXT_JUSTIFY_LEFT);
    }

    // Footer: the error or loading state if any, else `text`.
    function drawFooter(dc as Graphics.Dc, lv as Array<Char>?, text as String) as Void {
        if (_error != 0) {
            text = Ui.errorText(_error);
        } else if (_map == null) {
            text = "Loading...";
        } else if (lv == null) {
            text = "Source down";
        }
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(dc.getWidth() / 2, dc.getHeight() * 88 / 100, Graphics.FONT_XTINY, text,
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }
}
