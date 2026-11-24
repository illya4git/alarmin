import Toybox.Application;
import Toybox.Lang;
import Toybox.WatchUi;

(:glance)
class AlarminApp extends Application.AppBase {
    function initialize() {
        AppBase.initialize();
    }

    // Only called in the full app, never in glance mode.
    (:typecheck(disableGlanceCheck))
    function getInitialView() as [WatchUi.Views] or [WatchUi.Views, WatchUi.InputDelegates] {
        return [new MainView(), new MainDelegate()];
    }

    function getGlanceView() as [WatchUi.GlanceView] or [WatchUi.GlanceView, WatchUi.GlanceViewDelegate] or Null {
        return [new StatusGlance()];
    }

    // Region or proxy changed in the Garmin Connect app.
    function onSettingsChanged() as Void {
        WatchUi.requestUpdate();
    }
}
