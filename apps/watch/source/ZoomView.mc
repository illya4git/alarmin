import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

// Zoomed map (START on the map page, plan §3.5): one oblast filling the screen, its raions coloured
// from /v1/o/:oblastId (polled every 15 s while visible), the selected raion outlined in white.
// The oblast's font and glyph rows (RaionData, gen-zoom.ts) are loaded on show and released on
// hide, so zoom costs nothing while it isn't open.
class ZoomView extends GlyphMapView {
    private var _oblastId as Number;
    private var _font as WatchUi.FontResource?;
    // Per glyph: [raionId, digit idx, x, y, name]; idx -1 = no data.
    private var _rows as Array<Array>?;

    function initialize(oblastId as Number) {
        GlyphMapView.initialize();
        _oblastId = oblastId;
    }

    function path() as String {
        return "/v1/o/" + _oblastId;
    }

    function onShow() as Void {
        _font = Raions.font(_oblastId);
        _rows = Raions.load(_oblastId);
        startPolling();
    }

    function onHide() as Void {
        stopPolling();
        _font = null;
        _rows = null;
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

        var lv = digits();
        var font = _font;
        var rows = _rows;
        if (font != null && rows != null) {
            var selected = Raions.zoomRaion(Settings.regionId());
            var sel = -1;
            for (var k = 0; k < rows.size(); k++) {
                var r = rows[k];
                drawShape(dc, font, k, r[2] as Number, r[3] as Number, levelAt(lv, r[1] as Number));
                if (r[0] == selected) {
                    sel = k;
                }
            }
            if (sel >= 0) {
                drawSelected(dc, font, sel, rows[sel][2] as Number, rows[sel][3] as Number);
            }
        }
        drawFooter(dc, lv, Regions.nameOf(_oblastId));
    }
}

// START or BACK returns to the country map; UP / DOWN are kept so they don't leave the widget.
class ZoomDelegate extends WatchUi.BehaviorDelegate {
    function initialize() {
        BehaviorDelegate.initialize();
    }

    function onSelect() as Boolean {
        WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
        return true;
    }

    function onBack() as Boolean {
        WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
        return true;
    }

    function onPreviousPage() as Boolean {
        return true;
    }

    function onNextPage() as Boolean {
        return true;
    }
}
