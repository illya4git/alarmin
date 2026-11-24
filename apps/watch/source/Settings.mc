import Toybox.Application;
import Toybox.Lang;

// User settings (Application.Properties), editable on the watch and in Garmin Connect.
(:glance)
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
}
