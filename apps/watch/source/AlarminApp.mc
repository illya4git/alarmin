import Toybox.Application;
import Toybox.Background;
import Toybox.Lang;
import Toybox.System;
import Toybox.Time;
import Toybox.WatchUi;

// Runs in three contexts: the full widget, the glance, and the background service.
(:background, :glance)
class AlarminApp extends Application.AppBase {
    // Background check interval; 5 min is the platform minimum.
    const BACKGROUND_INTERVAL_S = 5 * 60;

    function initialize() {
        AppBase.initialize();
    }

    // Only called in the full app, never in glance or background mode.
    (:typecheck([disableBackgroundCheck, disableGlanceCheck]))
    function getInitialView() as [WatchUi.Views] or [WatchUi.Views, WatchUi.InputDelegates] {
        registerBackground();
        return [new MainView(), new MainDelegate()];
    }

    (:typecheck(disableBackgroundCheck))
    function getGlanceView() as [WatchUi.GlanceView] or [WatchUi.GlanceView, WatchUi.GlanceViewDelegate] or Null {
        registerBackground();
        return [new StatusGlance()];
    }

    // Only called in the background process.
    (:typecheck(disableGlanceCheck))
    function getServiceDelegate() as [System.ServiceDelegate] {
        return [new BackgroundService()];
    }

    // The background service already wrote Storage; just redraw.
    (:typecheck(disableBackgroundCheck))
    function onBackgroundData(data as Application.PersistableType) as Void {
        WatchUi.requestUpdate();
    }

    // Region or proxy changed in the Garmin Connect app.
    (:typecheck(disableBackgroundCheck))
    function onSettingsChanged() as Void {
        WatchUi.requestUpdate();
    }

    // Registers the temporal event once; it survives app restarts.
    private function registerBackground() as Void {
        if (Background.getTemporalEventRegisteredTime() == null) {
            Background.registerForTemporalEvent(new Time.Duration(BACKGROUND_INTERVAL_S));
        }
    }
}
