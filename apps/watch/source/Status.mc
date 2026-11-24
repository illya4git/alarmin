import Toybox.Application;
import Toybox.Lang;
import Toybox.Time;

// Last known status for the selected region, persisted in Application.Storage so the
// glance can draw without a network call. Stored as a flat dictionary:
//   "r" region id, "l" level, "f" flags, "t" since (epoch s, 0 = unknown),
//   "ft" fetched at (watch epoch s), "a" proxy data age at fetch (s), "x" proxy stale flag,
//   "e" last error code (0 = ok), "et" when that error happened.
// Written by the glance, the widget and (API >= 3.2) the background service.
(:background, :glance)
module Status {
    const STORAGE_KEY = "st";
    const UNKNOWN = -1;
    // Custom error code: phone not connected, request not attempted.
    const ERR_NO_PHONE = -1000;
    // Older data than this is not shown as a colour.
    const MAX_AGE_S = 15 * 60;

    // Pending "vibrate on open" after a wake prompt: [level, set at (epoch s)].
    const WAKE_KEY = "wk";
    // A wake marker older than this is ignored (prompt declined, app opened later).
    const WAKE_MAX_AGE_S = 10 * 60;

    function setPendingWake(level as Number) as Void {
        Storage.setValue(WAKE_KEY, [level, Time.now().value()] as Array<Storage.ValueType>);
    }

    // Returns the level of a recent wake prompt and clears the marker, or UNKNOWN.
    function takePendingWake() as Number {
        var v = Storage.getValue(WAKE_KEY);
        if (v == null) {
            return UNKNOWN;
        }
        Storage.deleteValue(WAKE_KEY);
        if (v instanceof Array && v.size() == 2) {
            var level = v[0];
            var at = v[1];
            if (level instanceof Number && at instanceof Number && Time.now().value() - at <= WAKE_MAX_AGE_S) {
                return level;
            }
        }
        return UNKNOWN;
    }

    function load() as Dictionary<String, Number> {
        var v = Storage.getValue(STORAGE_KEY);
        if (v instanceof Dictionary) {
            return v as Dictionary<String, Number>;
        }
        return {} as Dictionary<String, Number>;
    }

    // Saves a /v1/s/:id response.
    function saveSuccess(regionId as Number, data as Dictionary<String, Object or Null>) as Void {
        var st = {
            "r" => regionId,
            "l" => toNumber(data["l"], UNKNOWN),
            "f" => toNumber(data["f"], 0),
            "t" => toNumber(data["t"], 0),
            "a" => toNumber(data["a"], 0),
            "x" => toNumber(data["x"], 0),
            "ft" => Time.now().value(),
            "e" => 0,
            "et" => 0
        } as Dictionary<String, Number>;
        Storage.setValue(STORAGE_KEY, st as Dictionary<Storage.KeyType, Storage.ValueType>);
    }

    // Records a failed request, keeping the last good data.
    function saveError(regionId as Number, code as Number) as Void {
        var st = load();
        if (st["r"] != regionId) {
            st = {"r" => regionId} as Dictionary<String, Number>;
        }
        st["e"] = code;
        st["et"] = Time.now().value();
        Storage.setValue(STORAGE_KEY, st as Dictionary<Storage.KeyType, Storage.ValueType>);
    }

    // Status for the currently selected region, or an empty dictionary.
    function current() as Dictionary<String, Number> {
        var st = load();
        return st["r"] == Settings.regionId() ? st : ({} as Dictionary<String, Number>);
    }

    // Seconds since the proxy last saw fresh upstream data, or -1 if never fetched.
    function dataAge(st as Dictionary<String, Number>) as Number {
        var ft = st["ft"];
        if (ft == null) {
            return -1;
        }
        var a = st["a"];
        return Time.now().value() - ft + (a == null || a < 0 ? 0 : a);
    }

    // Level to display: a Levels value, or UNKNOWN if missing, stale or too old.
    function displayLevel(st as Dictionary<String, Number>) as Number {
        var l = st["l"];
        if (l == null || st["x"] == 1) {
            return UNKNOWN;
        }
        var age = dataAge(st);
        return (age < 0 || age > MAX_AGE_S) ? UNKNOWN : l;
    }

    // Seconds since the last fetch attempt finished (success or error), or a large number.
    function secondsSinceAttempt(st as Dictionary<String, Number>) as Number {
        var last = 0;
        var ft = st["ft"];
        var et = st["et"];
        if (ft != null && ft > last) {
            last = ft;
        }
        if (et != null && et > last) {
            last = et;
        }
        return last == 0 ? 999999 : Time.now().value() - last;
    }

    function toNumber(v as Object or Null, fallback as Number) as Number {
        if (v instanceof Number) {
            return v;
        } else if (v instanceof Long) {
            return v.toNumber();
        } else if (v instanceof Float) {
            return v.toNumber();
        } else if (v instanceof Double) {
            return v.toNumber();
        }
        return fallback;
    }
}
