// Spike: can the FR55's system fonts draw Ukrainian (D8)?
// Pages (UP / DOWN): one per system font with sample text, then a table of glyph widths.
// A glyph the font lacks measures 0 px (or the width of the font's fallback box).

import Toybox.Application;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

class CyrillicApp extends Application.AppBase {
    function initialize() {
        AppBase.initialize();
    }

    function getInitialView() {
        var view = new CyrillicView();
        return [view, new CyrillicDelegate(view)];
    }
}

const FONTS = [Graphics.FONT_XTINY, Graphics.FONT_TINY, Graphics.FONT_SMALL, Graphics.FONT_MEDIUM, Graphics.FONT_LARGE];
const FONT_NAMES = ["XTINY", "TINY", "SMALL", "MEDIUM", "LARGE"];

// Ukrainian-only letters first (absent from Russian), then a few shared ones, the apostrophes,
// and a CJK character as a known-missing reference.
const CHARS = [
    0x0404, 0x0454, 0x0406, 0x0456, 0x0407, 0x0457, 0x0490, 0x0491,
    0x0416, 0x0436, 0x0429, 0x0449, 0x042E, 0x044E, 0x2019, 0x02BC,
    0x0041, 0x4E2D
];

class CyrillicView extends WatchUi.View {
    var page as Number = 0;

    function initialize() {
        View.initialize();
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();
        var w = dc.getWidth();
        var c = Graphics.TEXT_JUSTIFY_CENTER;
        if (page < FONTS.size()) {
            var f = FONTS[page];
            var lh = dc.getFontHeight(f);
            dc.drawText(w / 2, 14, Graphics.FONT_XTINY, (page + 1) + "/" + (FONTS.size() + 1) + " " + FONT_NAMES[page], c);
            var lines = [
                "Київ Львів Одеса",
                "Харківська",
                "Є є Ї ї І і Ґ ґ",
                "м’ята сім'я",
                WatchUi.loadResource(Rez.Strings.Sample) as String,
                "Kyivska (Latin)"
            ];
            var y = 38;
            for (var i = 0; i < lines.size() && y + lh < 200; i++) {
                dc.drawText(w / 2, y, f, lines[i], c);
                y += lh;
            }
        } else {
            // Width in px per character: XTINY / SMALL.
            dc.drawText(w / 2, 14, Graphics.FONT_XTINY, FONTS.size() + 1 + "/" + (FONTS.size() + 1) + " widths xt/sm", c);
            var lh = dc.getFontHeight(Graphics.FONT_XTINY);
            for (var i = 0; i < CHARS.size(); i++) {
                var s = CHARS[i].toChar().toString();
                var col = i % 2;
                var row = i / 2;
                var label = CHARS[i].format("%04X") + " " + s + " "
                    + dc.getTextWidthInPixels(s, Graphics.FONT_XTINY) + "/"
                    + dc.getTextWidthInPixels(s, Graphics.FONT_SMALL);
                dc.drawText(col == 0 ? 102 : 106, 34 + row * (lh - 2), Graphics.FONT_XTINY, label,
                    col == 0 ? Graphics.TEXT_JUSTIFY_RIGHT : Graphics.TEXT_JUSTIFY_LEFT);
            }
        }
    }
}

class CyrillicDelegate extends WatchUi.BehaviorDelegate {
    private var _view as CyrillicView;

    function initialize(view as CyrillicView) {
        BehaviorDelegate.initialize();
        _view = view;
    }

    function onNextPage() as Boolean {
        _view.page = (_view.page + 1) % (FONTS.size() + 1);
        WatchUi.requestUpdate();
        return true;
    }

    function onPreviousPage() as Boolean {
        _view.page = (_view.page + FONTS.size()) % (FONTS.size() + 1);
        WatchUi.requestUpdate();
        return true;
    }
}
