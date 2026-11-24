# Spike: application wake prompt

Shows what `Background.requestApplicationWake()` looks like on a Forerunner 55, and tests whether it vibrates or beeps.

- **START** toggles a 5-minute temporal event (red screen = armed, green = off).
- Each event asks: "Kyivska: RED alert. Open Wake Demo?"
- Opening the widget while armed vibrates (long-short-long), the way the real app would after a wake.
- The glance shows the armed state and the time of the last background run.

## Build

```powershell
$sdk = (Get-Content "$env:APPDATA\Garmin\ConnectIQ\current-sdk.cfg").Trim()
& "$sdk\bin\monkeyc.bat" -d fr55 -f monkey.jungle -o bin\WakeDemo.prg -y <path-to-developer_key> -w
```

## Simulator

1. Start `simulator.exe`, then `monkeydo.bat bin\WakeDemo.prg fr55`.
2. Press START in the widget to arm it.
3. **Simulation → Background Events → Temporal Event** fires it immediately instead of after 5 min.

## Real device

Copy `bin\WakeDemo.prg` to `GARMIN\APPS\` on the watch over USB. Then record:

| Check                                      | Result |
| ------------------------------------------ | ------ |
| Dialog layout / buttons                    |        |
| Vibration or tone when the dialog appears  |        |
| Shown during an activity (run)?            |        |
| Shown in Do Not Disturb / sleep mode?      |        |
| Shown while another widget or app is open? |        |
| What happens if ignored (timeout)?         |        |

Disarm (START → green) or delete the app afterwards. Otherwise it prompts every 5 minutes.
