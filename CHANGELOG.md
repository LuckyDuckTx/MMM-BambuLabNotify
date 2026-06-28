# Changelog

## 1.5.2 - 2026-06-26

### Fixed
- Minor spacing issue between layer counter and percent completed. 
- Now automatically requests a full printer status snapshot when active print updates are missing information.

## 1.5.1 - 2026-06-11

### Added
- Added external spool filament display.
- Added `textSize` config option for small, medium, or large panel text.

### Fixed
- Refreshed the panel when layer data changes, even if progress bucket, ETA, temperatures, and filament data are unchanged.
- Reset MQTT sequence tracking after reconnect so printer power cycles do not cause fresh status messages to be dropped.

### Changed

- Changed default `progressStep` from `5` to `1` for more responsive progress updates.

## 1.5 - 2026-05-29

### Added
- Added optional `text` configuration for customizing panel and status labels, and toast messages without editing module source files.
- Added nozzle and bed temperature display to the status panel.
- Added AMS filament display with color swatches, filament type, slot number, and empty slot indicators.
- Added active AMS slot highlighting with a slow pulsing color indicator.
- Added `displayTemperatures` and `displayAms` config options.
- Added `temperatureUnit` config option to show panel temperatures in Celsius or Fahrenheit.

### Changed
- Reworked the status panel layout with the printer name and status pill on one row.
- Moved the current job name to its own full-width row.
- Laid out temperature and AMS chips in two columns for a cleaner panel.


## 1.0 - 2025-08-31

- Initial launch of MMM-BambuLab-Notify
