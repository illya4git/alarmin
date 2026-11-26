import Toybox.Application;
import Toybox.Communications;
import Toybox.Lang;

// User settings (Application.Properties), editable on the watch and in Garmin Connect.
(:background, :glance)
module Settings {
    // Storage key of the selected raion's [id, oblastId, name]. The raion table is a resource
    // only the foreground loads (Raions.mc); the glance and background read the name from here.
    const KEY_RAION = "rn";

    // Selected region: a top-level region ID or a raion ID (the proxy takes both). Raion IDs
    // are validated in the foreground (Raions.ensureCached).
    function regionId() as Number {
        var v = Properties.getValue("regionId");
        return (v instanceof Number && v > 0) ? v : Regions.DEFAULT_ID;
    }

    function setRegionId(id as Number) as Void {
        Properties.setValue("regionId", id);
    }

    // Cached [id, oblastId, name] when the selected region is a raion and the cache matches it.
    function raion() as Array? {
        var id = regionId();
        if (Regions.indexOf(id) >= 0) {
            return null;
        }
        var c = Storage.getValue(KEY_RAION);
        if (c instanceof Array && c.size() == 3) {
            var cachedId = c[0];
            if (cachedId instanceof Number && cachedId == id) {
                return c as Array;
            }
        }
        return null;
    }

    // Display name of the selected region or raion.
    function regionName() as String {
        var id = regionId();
        var i = Regions.indexOf(id);
        if (i >= 0) {
            return Regions.NAMES[i];
        }
        var r = raion();
        // Picked on the phone and not yet resolved: the widget resolves it when it opens.
        return r != null ? r[2] as String : "Raion " + id;
    }

    // Top-level region containing the selection (itself for a region), or -1 if not yet known.
    function oblastId() as Number {
        var id = regionId();
        if (Regions.indexOf(id) >= 0) {
            return id;
        }
        var r = raion();
        return r != null ? r[1] as Number : -1;
    }

    // Proxy base URL without trailing slash; the settings override wins over the built-in one.
    function proxyUrl() as String {
        var v = Properties.getValue("proxyUrl");
        if (v instanceof String && v.length() > 0) {
            return v;
        }
        return Secrets.PROXY_URL;
    }

    // Whether a change to `level` should trigger the wake prompt (plan D6; default on).
    function alarmEnabled(level as Number) as Boolean {
        var v = Properties.getValue(alarmKey(level));
        return !(v instanceof Boolean) || v;
    }

    function setAlarmEnabled(level as Number, on as Boolean) as Void {
        Properties.setValue(alarmKey(level), on);
    }

    function alarmKey(level as Number) as String {
        return level == Levels.RED ? "alRed" : level == Levels.YELLOW ? "alYellow" : "alGreen";
    }

    // URL of the status endpoint for a region.
    function statusUrl(regionId as Number) as String {
        return proxyUrl() + "/v1/s/" + regionId;
    }

    // makeWebRequest options for proxy calls.
    function requestOptions() as {
        :method as Communications.HttpRequestMethod,
        :headers as Dictionary,
        :responseType as Communications.HttpResponseContentType
    } {
        return {
            :method => Communications.HTTP_REQUEST_METHOD_GET,
            // The second header skips ngrok's free-tier HTML warning page (test tunnels);
            // other servers ignore it.
            :headers => {"X-Alarmin-Key" => Secrets.APP_KEY, "ngrok-skip-browser-warning" => "1"},
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };
    }
}
