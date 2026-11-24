import Toybox.Communications;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Time;
import Toybox.Time.Gregorian;

// Colours and text shared by the glance and the main view.
// Pure palette colours only: the FR55 MIP display has 8 colours.
(:glance)
module Ui {
    const COLOR_RED = 0xFF0000;
    const COLOR_YELLOW = 0xFFFF00;
    const COLOR_GREEN = 0x00FF00;

    function background(level as Number) as Number {
        if (level == Levels.RED) {
            return COLOR_RED;
        } else if (level == Levels.YELLOW) {
            return COLOR_YELLOW;
        } else if (level == Levels.GREEN) {
            return COLOR_GREEN;
        }
        return Graphics.COLOR_BLACK;
    }

    function foreground(level as Number) as Number {
        return (level == Levels.YELLOW || level == Levels.GREEN) ? Graphics.COLOR_BLACK : Graphics.COLOR_WHITE;
    }

    // Short headline for a level and its flags.
    function headline(level as Number, flags as Number) as String {
        if (level == Levels.RED) {
            return "AIR ALERT";
        } else if (level == Levels.YELLOW) {
            return (flags & Levels.FLAG_OWN_YELLOW) != 0 ? "THREAT" : "PARTIAL";
        } else if (level == Levels.GREEN) {
            return "CLEAR";
        }
        return "NO DATA";
    }

    // "since 14:05" for today, "since 17 Sep" for older; "" if unknown.
    function since(t as Number) as String {
        if (t <= 0) {
            return "";
        }
        var moment = new Time.Moment(t);
        if (Time.now().value() - t < 20 * 3600) {
            var info = Gregorian.info(moment, Time.FORMAT_SHORT);
            return "since " + info.hour.format("%02d") + ":" + info.min.format("%02d");
        }
        var info = Gregorian.info(moment, Time.FORMAT_MEDIUM);
        return "since " + info.day + " " + info.month;
    }

    function age(seconds as Number) as String {
        if (seconds < 60) {
            return seconds + "s ago";
        } else if (seconds < 3600) {
            return (seconds / 60) + "m ago";
        }
        return (seconds / 3600) + "h ago";
    }

    function errorText(code as Number) as String {
        if (code == StatusRequest.ERR_NO_PHONE || code == Communications.BLE_CONNECTION_UNAVAILABLE) {
            return "No phone";
        } else if (code == Communications.NETWORK_REQUEST_TIMED_OUT) {
            return "Timeout";
        } else if (code == 401) {
            return "Bad app key";
        } else if (code == 404) {
            return "Unknown region";
        } else if (code == 503) {
            return "Server starting";
        }
        return "Error " + code;
    }
}
