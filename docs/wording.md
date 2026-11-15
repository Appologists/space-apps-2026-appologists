# How the app words things

Every sentence on screen should say **what we computed**, **what it means**, and, where it matters, **what it
does not cover**. Never promise more than the numbers support. We compute geometry, not probabilities, so
avoid "likely" and "unlikely" too: say what was found.

| Instead of | Say |
| --- | --- |
| "Communication available", "can talk to Earth" | "Earth is in view above the terrain, so a direct-to-Earth link is possible. Antennas, transmitter power and station schedules are not checked." |
| "No signal", "unlikely" | "Earth is hidden behind terrain: no direct line of sight. Direct contact is not expected; a relay would be needed." |
| "Safe site", "good site", "safest" | "Passes your rules: slope under 10°, darkness under 50 h, Earth at landing." |
| "Power: 120 W" | "About 120 W estimated for an example 1 m² panel at 30% efficiency. Excludes dust, heat and ageing." |
| "The Sun never sets here" | "The Sun stays up for the whole stay" (we only looked at the stay). |
| "Accurate" | Say what was checked, against what: "Sun and Earth positions agree with JPL Horizons to about 0.004°." |

Rules of thumb:

- **Name the rule.** "Earth in view" means its centre (or any part, if the user chose that) clears the terrain.
- **Name the range.** "Not seen in the 30 days checked" is not "never".
- **Missing data stays missing.** Show "no data", never a zero or a pass.
- **Examples are labelled.** Any default the user did not type (a panel, a load) is called an example and can be changed.
- **Estimates say so**, and say what they leave out.
