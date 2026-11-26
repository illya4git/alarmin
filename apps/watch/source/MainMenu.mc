import Toybox.Lang;
import Toybox.WatchUi;

// Main menu (target UI page 3, plan §3.5): region, alerts, about.
// Reached with DOWN from the map; UP from the first item goes back to the map.
class MainMenu extends WatchUi.Menu2 {
    function initialize() {
        Menu2.initialize({:title => "Alarmin"});
        addItem(new WatchUi.MenuItem("Region", Regions.nameOf(Settings.regionId()), :region, null));
        addItem(new WatchUi.MenuItem("Alerts", "Prompt on change", :alerts, null));
        addItem(new WatchUi.MenuItem("About", null, :about, null));
    }

    // Back from the region picker: show the new choice.
    function onShow() as Void {
        Menu2.onShow();
        var item = getItem(findItemById(:region));
        if (item != null) {
            item.setSubLabel(Regions.nameOf(Settings.regionId()));
        }
    }
}

class MainMenuDelegate extends WatchUi.Menu2InputDelegate {
    function initialize() {
        Menu2InputDelegate.initialize();
    }

    // No wrapping: UP past the first item returns to the map, DOWN past the last stays put.
    function onWrap(key as WatchUi.Key) as Boolean {
        if (key == WatchUi.KEY_UP) {
            WatchUi.popView(WatchUi.SLIDE_DOWN);
        }
        return false;
    }

    function onSelect(item as WatchUi.MenuItem) as Void {
        var id = item.getId();
        if (id == :region) {
            WatchUi.pushView(new RegionPicker(), new RegionPickerDelegate(), WatchUi.SLIDE_LEFT);
        } else if (id == :alerts) {
            WatchUi.pushView(new AlertsMenu(), new AlertsMenuDelegate(), WatchUi.SLIDE_LEFT);
        } else if (id == :about) {
            WatchUi.pushView(new AboutView(), new WatchUi.BehaviorDelegate(), WatchUi.SLIDE_LEFT);
        }
    }
}
