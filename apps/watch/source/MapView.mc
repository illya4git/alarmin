import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

// Page 2 (plan §3.5): minimap. Oblasts filled from /v1/all (polled every 15 s while visible), the
// selected region outlined in white. Each region is a glyph of the Map font (gen-map.ts): about 55
// drawText calls and no per-point work. The font is loaded on show and released on hide.
class MapView extends GlyphMapView {
    private var _font as WatchUi.FontResource?;

    function initialize() {
        GlyphMapView.initialize();
    }

    function path() as String {
        return "/v1/all";
    }

    function onShow() as Void {
        _font = WatchUi.loadResource(Rez.Fonts.Map) as WatchUi.FontResource;
        startPolling();
    }

    function onHide() as Void {
        stopPolling();
        _font = null;
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

        var lv = digits();
        var counts = [0, 0, 0] as Array<Number>;
        for (var i = 0; lv != null && i < lv.size(); i++) {
            var l = levelAt(lv, i);
            if (l >= 0) {
                counts[l] += 1;
            }
        }

        var font = _font;
        if (font != null) {
            var selected = Regions.indexOf(Settings.oblastId());
            var sel = -1;
            for (var k = 0; k < MapData.COUNT; k++) {
                var idx = MapData.IDX[k];
                drawShape(dc, font, k, MapData.X[k], MapData.Y[k], levelAt(lv, idx));
                if (idx == selected) {
                    sel = k;
                }
            }
            if (sel >= 0) {
                drawSelected(dc, font, sel, MapData.X[sel], MapData.Y[sel]);
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

        var text = counts[Levels.RED] + counts[Levels.YELLOW] == 0
            ? "All clear"
            : counts[Levels.RED] + " red  " + counts[Levels.YELLOW] + " yellow";
        drawFooter(dc, lv, text);
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

    // START → the selected region's oblast zoomed in to its raions (Kyiv city: Kyivska; none for Crimea).
    function onSelect() as Boolean {
        var oblastId = Raions.zoomOblast(Settings.regionId());
        if (oblastId > 0) {
            WatchUi.pushView(new ZoomView(oblastId), new ZoomDelegate(), WatchUi.SLIDE_IMMEDIATE);
        }
        return true;
    }

    // DOWN → menu (page 3); BACK or UP from its first item returns here.
    function onNextPage() as Boolean {
        WatchUi.pushView(new MainMenu(), new MainMenuDelegate(), WatchUi.SLIDE_UP);
        return true;
    }
}
