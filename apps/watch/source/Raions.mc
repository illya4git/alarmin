import Toybox.Application;
import Toybox.Lang;
import Toybox.WatchUi;

// Raion data: one generated resource per oblast (RaionData.mc, gen-zoom.ts) with
// [raionId, digit idx, x, y, name] per glyph of the oblast's zoom font, raions alphabetically, then
// "no data" shapes (idx -1). Foreground only, loaded one oblast at a time: by the picker, the zoomed
// map, and to resolve a raion picked on the phone.
module Raions {
    // Position of an oblast in RaionData, or -1 if it has no raions.
    function indexOf(oblastId as Number) as Number {
        for (var i = 0; i < RaionData.OBLASTS.size(); i++) {
            if (RaionData.OBLASTS[i] == oblastId) {
                return i;
            }
        }
        return -1;
    }

    // The oblast's glyph rows, or null if it has no raions.
    function load(oblastId as Number) as Array<Array>? {
        var i = indexOf(oblastId);
        return i >= 0 ? WatchUi.loadResource(RaionData.DATA[i]) as Array<Array> : null;
    }

    // The oblast's zoom font, or null.
    function font(oblastId as Number) as WatchUi.FontResource? {
        var i = indexOf(oblastId);
        return i >= 0 ? WatchUi.loadResource(RaionData.FONTS[i]) as WatchUi.FontResource : null;
    }

    // Oblast to zoom into for a selected region or raion: its oblast (a city's parent), or -1.
    function zoomOblast(regionId as Number) as Number {
        var c = RaionData.CITIES.indexOf(regionId);
        if (c >= 0) {
            return RaionData.CITY_OBLASTS[c];
        }
        var oblastId = Settings.oblastId();
        return indexOf(oblastId) >= 0 ? oblastId : -1;
    }

    // Shape to outline when zoomed: the selected raion, the raion a selected city lies in, or the
    // region itself when it's drawn in the zoom (Kyiv city).
    function zoomRaion(regionId as Number) as Number {
        var c = RaionData.CITIES.indexOf(regionId);
        return c >= 0 ? RaionData.CITY_RAIONS[c] : regionId;
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
            var rows = load(oblastId);
            for (var j = 0; rows != null && j < rows.size(); j++) {
                if (rows[j][0] == id) {
                    select(id, oblastId, rows[j][4] as String);
                    return;
                }
            }
        }
        Settings.setRegionId(Regions.DEFAULT_ID);
    }
}
