import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

// Page indicator for the widget's pages (status, map, menu; plan §3.5): three dots in a row along
// the top edge, the current page filled. Foreground only (not in the glance).
module PageDots {
    const COUNT = 3;
    const STATUS = 0;
    const MAP = 1;
    const MENU = 2;
    const TOP = 10;
    const GAP = 10;

    // Dots centred on screen; for a full-screen dc.
    function draw(dc as Graphics.Dc, page as Number, color as Number) as Void {
        drawAt(dc, dc.getWidth() / 2, TOP, page, color);
    }

    // Dots centred on (cx, y) in the dc's coordinates.
    function drawAt(dc as Graphics.Dc, cx as Number, y as Number, page as Number, color as Number) as Void {
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        for (var i = 0; i < COUNT; i++) {
            var x = cx + (i - (COUNT - 1) / 2) * GAP;
            if (i == page) {
                dc.fillCircle(x, y, 3);
            } else {
                dc.drawCircle(x, y, 3);
            }
        }
    }
}

// Menu2 title with the page dots above it (Menu2 takes a Drawable as its title).
class DotsTitle extends WatchUi.Drawable {
    // Menu2 gives the title its own dc (114x60 in the simulator), placed slightly differently in the
    // simulator and on the FR55; centring in it lines up closely enough with the other pages.
    private var _text as String;

    function initialize(text as String) {
        Drawable.initialize({});
        _text = text;
    }

    function draw(dc as Graphics.Dc) as Void {
        var cx = dc.getWidth() / 2;
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, dc.getHeight() / 2 + 6, Graphics.FONT_SMALL, _text,
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        PageDots.drawAt(dc, cx, PageDots.TOP, PageDots.MENU, Graphics.COLOR_WHITE);
    }
}
