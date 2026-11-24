import Toybox.Application;
import Toybox.Communications;
import Toybox.Lang;

// User settings (Application.Properties), editable on the watch and in Garmin Connect.
(:background, :glance)
module Settings {
    function regionId() as Number {
        var v = Properties.getValue("regionId");
        return (v instanceof Number && Regions.indexOf(v) >= 0) ? v : Regions.DEFAULT_ID;
    }

    function setRegionId(id as Number) as Void {
        Properties.setValue("regionId", id);
    }

    // Proxy base URL without trailing slash; the settings override wins over the built-in one.
    function proxyUrl() as String {
        var v = Properties.getValue("proxyUrl");
        if (v instanceof String && v.length() > 0) {
            return v;
        }
        return Secrets.PROXY_URL;
    }

    // Whether a change to `level` should trigger the wake prompt (plan D6; all on for now).
    function alarmEnabled(level as Number) as Boolean {
        var key = level == Levels.RED ? "alRed" : level == Levels.YELLOW ? "alYellow" : "alGreen";
        var v = Properties.getValue(key);
        return !(v instanceof Boolean) || v;
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
            :headers => {"X-Alarmin-Key" => Secrets.APP_KEY},
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };
    }
}
