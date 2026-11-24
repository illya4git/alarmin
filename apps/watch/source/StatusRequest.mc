import Toybox.Communications;
import Toybox.Lang;
import Toybox.System;
import Toybox.WatchUi;

// Fetches /v1/s/:id for the selected region and stores the result in Status.
(:glance)
class StatusRequest {
    // Custom error code: phone not connected, request not attempted.
    static const ERR_NO_PHONE = -1000;

    private var _inFlight as Boolean = false;
    private var _regionId as Number = 0;

    function initialize() {
    }

    function fetch() as Void {
        if (_inFlight) {
            return;
        }
        _regionId = Settings.regionId();
        if (!System.getDeviceSettings().phoneConnected) {
            Status.saveError(_regionId, ERR_NO_PHONE);
            WatchUi.requestUpdate();
            return;
        }
        _inFlight = true;
        Communications.makeWebRequest(
            Settings.proxyUrl() + "/v1/s/" + _regionId,
            null,
            {
                :method => Communications.HTTP_REQUEST_METHOD_GET,
                :headers => {"X-Alarmin-Key" => Secrets.APP_KEY},
                :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
            },
            method(:onResponse)
        );
    }

    function onResponse(code as Number, data as Dictionary or String or Null) as Void {
        _inFlight = false;
        if (code == 200 && data instanceof Dictionary) {
            Status.saveSuccess(_regionId, data as Dictionary<String, Object or Null>);
        } else {
            Status.saveError(_regionId, code);
        }
        WatchUi.requestUpdate();
    }
}
