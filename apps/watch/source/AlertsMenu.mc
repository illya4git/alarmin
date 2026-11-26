import Toybox.Lang;
import Toybox.WatchUi;

// Which colour changes bring up the wake prompt (plan D6). Same properties as the phone settings.
class AlertsMenu extends WatchUi.Menu2 {
    function initialize() {
        Menu2.initialize({:title => "Prompt on"});
        addToggle("Air alert", "red", Levels.RED);
        addToggle("Partial/threat", "yellow", Levels.YELLOW);
        addToggle("All clear", "green", Levels.GREEN);
    }

    private function addToggle(label as String, sub as String, level as Number) as Void {
        addItem(new WatchUi.ToggleMenuItem(label, sub, level, Settings.alarmEnabled(level), null));
    }
}

class AlertsMenuDelegate extends WatchUi.Menu2InputDelegate {
    function initialize() {
        Menu2InputDelegate.initialize();
    }

    function onSelect(item as WatchUi.MenuItem) as Void {
        var level = item.getId();
        if (item instanceof WatchUi.ToggleMenuItem && level instanceof Number) {
            Settings.setAlarmEnabled(level, item.isEnabled());
        }
    }

    function onWrap(key as WatchUi.Key) as Boolean {
        return false;
    }
}
