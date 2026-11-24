import Toybox.Lang;
import Toybox.WatchUi;

// Alphabetical list of regions; the current one is focused.
class RegionPicker extends WatchUi.Menu2 {
    function initialize() {
        Menu2.initialize({:title => "Region"});
        var current = Settings.regionId();
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
        if (id instanceof Number) {
            Settings.setRegionId(id);
        }
        // MainView.onShow refetches for the new region.
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
    }
}
