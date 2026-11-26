import Toybox.Application;
import Toybox.Lang;
import Toybox.WatchUi;

// Raion table: one generated resource per oblast ([[raionId, "name"], ...], RaionData.mc).
// Foreground only, loaded one oblast at a time: by the picker, and to resolve a raion picked on
// the phone.
module Raions {
    // Raions of an oblast (alphabetical), or null if it has none.
    function load(oblastId as Number) as Array<Array>? {
        var res = RaionData.resource(oblastId);
        return res != null ? WatchUi.loadResource(res) as Array<Array> : null;
    }

    // Selects a raion picked on the watch and caches its name for the glance and background.
    function select(id as Number, oblastId as Number, name as String) as Void {
        Settings.setRegionId(id);
        Storage.setValue(Settings.KEY_RAION, [id, oblastId, name]);
    }

    // Makes sure a raion selected on the phone has its name cached; resets an unknown ID to the
    // default region. Cheap when nothing changed (no resource load).
    function ensureCached() as Void {
        var id = Settings.regionId();
        if (Regions.indexOf(id) >= 0 || Settings.raion() != null) {
            return;
        }
        for (var i = 0; i < RaionData.OBLASTS.size(); i++) {
            var oblastId = RaionData.OBLASTS[i];
            var list = load(oblastId);
            for (var j = 0; list != null && j < list.size(); j++) {
                if (list[j][0] == id) {
                    select(id, oblastId, list[j][1] as String);
                    return;
                }
            }
        }
        Settings.setRegionId(Regions.DEFAULT_ID);
    }
}
