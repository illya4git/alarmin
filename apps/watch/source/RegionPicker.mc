import Toybox.Lang;
import Toybox.WatchUi;

// Step 1: alphabetical list of regions, the current one (or the current raion's oblast) focused.
// A region with raions opens step 2; others are selected directly.
class RegionPicker extends WatchUi.Menu2 {
    function initialize() {
        Menu2.initialize({:title => "Region"});
        var current = Settings.oblastId();
        var focus = 0;
        for (var i = 0; i < Regions.PICKER_ORDER.size(); i++) {
            var idx = Regions.PICKER_ORDER[i];
            var id = Regions.IDS[idx];
            addItem(new WatchUi.MenuItem(Regions.NAMES[idx], null, id, null));
            if (id == current) {
                focus = i;
            }
        }
        setFocus(focus);
    }
}

class RegionPickerDelegate extends WatchUi.Menu2InputDelegate {
    function initialize() {
        Menu2InputDelegate.initialize();
    }

    function onSelect(item as WatchUi.MenuItem) as Void {
        var id = item.getId();
        if (!(id instanceof Number)) {
            return;
        }
        var raions = Raions.load(id);
        if (raions != null) {
            WatchUi.pushView(new RaionPicker(id, raions), new RaionPickerDelegate(), WatchUi.SLIDE_LEFT);
            return;
        }
        Settings.setRegionId(id);
        // Back to the menu; MainView.onShow refetches for the new region.
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
    }
}

// Step 2: the whole oblast (first item) or one of its raions, the current choice focused.
class RaionPicker extends WatchUi.Menu2 {
    function initialize(oblastId as Number, raions as Array<Array>) {
        // No title: a long oblast name wraps badly in the round title area; the first item names it.
        Menu2.initialize({});
        var current = Settings.regionId();
        addItem(new WatchUi.MenuItem(Regions.nameOf(oblastId), "Whole oblast", [oblastId, oblastId, ""], null));
        // Rows are the oblast's zoom glyphs ([id, idx, x, y, name]): raions alphabetically, then
        // other regions drawn in the zoom and "no data" shapes.
        var focus = 0;
        var n = 1;
        for (var i = 0; i < raions.size(); i++) {
            var id = raions[i][0] as Number;
            // Not selectable here: "no data" shapes and other regions drawn in the zoom (Kyiv city).
            if ((raions[i][1] as Number) < 0 || Regions.indexOf(id) >= 0) {
                continue;
            }
            var name = raions[i][4] as String;
            addItem(new WatchUi.MenuItem(name, null, [id, oblastId, name], null));
            if (id == current) {
                focus = n;
            }
            n += 1;
        }
        setFocus(focus);
    }
}

class RaionPickerDelegate extends WatchUi.Menu2InputDelegate {
    function initialize() {
        Menu2InputDelegate.initialize();
    }

    function onSelect(item as WatchUi.MenuItem) as Void {
        var pick = item.getId();
        if (pick instanceof Array) {
            var id = pick[0] as Number;
            var oblastId = pick[1] as Number;
            if (id == oblastId) {
                Settings.setRegionId(id);
            } else {
                Raions.select(id, oblastId, pick[2] as String);
            }
        }
        // Back past the region list to the menu.
        WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
    }
}
