import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

// Disclaimer and data credits (plan §2: Siren and Tryvoha must be credited; the
// "not a life-safety system" note must be in the app). BACK returns to the menu.
class AboutView extends WatchUi.View {
    function initialize() {
        View.initialize();
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

        var now = "";
        var st = Status.current();
        if (st["s"] != null) {
            now = "\nNow via " + (st["s"] == Levels.SOURCE_TRYVOHA ? "Tryvoha" : "Siren");
        }
        // Short lines: the round screen narrows toward the top and bottom.
        var text = "Not a life-safety\nsystem. Official\nalerts come first.\n\nData: siren.pp.ua,\nTryvoha.online" + now;
        dc.drawText(dc.getWidth() / 2, dc.getHeight() / 2, Graphics.FONT_XTINY, text,
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }
}
