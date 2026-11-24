import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

// Glance: draws the stored status. On low-memory devices (FR55) the system renders it
// once per visit and caches the image, so it also asks for fresh data when shown;
// whether that reply lands before the glance is torn down is a Phase 0 check.
(:glance)
class StatusGlance extends WatchUi.GlanceView {
    // Don't refetch more often than this from the glance.
    const REFETCH_AFTER_S = 30;

    private var _request as StatusRequest = new StatusRequest();

    function initialize() {
        GlanceView.initialize();
    }

    function onShow() as Void {
        if (Status.secondsSinceAttempt(Status.current()) >= REFETCH_AFTER_S) {
            _request.fetch();
        }
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        var st = Status.current();
        var level = Status.displayLevel(st);
        var flags = st["f"] != null ? st["f"] as Number : 0;
        var h = dc.getHeight();
        var barW = 14;

        dc.setColor(Graphics.COLOR_TRANSPARENT, Graphics.COLOR_BLACK);
        dc.clear();
        dc.setColor(Ui.background(level), Graphics.COLOR_TRANSPARENT);
        if (level == Status.UNKNOWN) {
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawRectangle(0, 0, barW, h);
        } else {
            dc.fillRectangle(0, 0, barW, h);
        }

        var line2 = Ui.headline(level, flags);
        if (level != Status.UNKNOWN && st["t"] != null) {
            var since = Ui.since(st["t"] as Number);
            if (since.length() > 0) {
                line2 += " " + since;
            }
        }

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(barW + 6, h / 2, Graphics.FONT_GLANCE, Regions.nameOf(Settings.regionId()) + "\n" + line2,
            Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
    }
}
