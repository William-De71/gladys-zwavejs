# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org/). This file is generated at
each release from the Conventional Commits: do not edit it by hand.

Upstream versions (up to 1.8.0) are released by
[sescandell/gladys-zwavejs](https://github.com/sescandell/gladys-zwavejs/releases). The
1.8.0 below is this fork's first release, published by mistake under the upstream number:
1.9.0 is the same code under its own number.

## [1.9.0] - 2026-11-01

- Maintenance release.

## [1.8.0] - 2026-11-01

### Added

- **i18n:** German and Spanish everywhere, README at the level of the other integrations ([3fbe039](https://github.com/William-De71/gladys-zwavejs/commit/3fbe039cd0b23fd637493493088b041f42d7bc86))
- network widget, scene triggers and actions, and five more command classes ([f3bdb36](https://github.com/William-De71/gladys-zwavejs/commit/f3bdb368bcb043de72c3de0cfa2ac0d716ea2fba))
- **binary-sensor:** the Flush Pilot input is an input, not a motion sensor ([262072b](https://github.com/William-De71/gladys-zwavejs/commit/262072b367a7e548ced383c08cbd2f798fdd38c3))
- **multilevel-switch:** expose the Qubino Flush Pilot as a pilot wire heater ([ce2263e](https://github.com/William-De71/gladys-zwavejs/commit/ce2263eb8f2492eaae891ffb11b53bc5b47a04d7))
- **transport:** publish a per-device transport badge ([87705c7](https://github.com/William-De71/gladys-zwavejs/commit/87705c7f5be525cf3e6aa58ca3344e23ef391ce9))
- **notification:** support Zooz ZEN55 smoke & CO alarms ([c902063](https://github.com/William-De71/gladys-zwavejs/commit/c9020633b89b5df3f9d1e3a7e145035d3d149fc3))

### Fixed

- **multilevel-sensor:** a temperature below absolute zero is not published ([2465a8d](https://github.com/William-De71/gladys-zwavejs/commit/2465a8da08b3dbba584e950a4aa760b3cf8f82a6))
- **registry:** a node event no longer empties the cached node ([c411cbe](https://github.com/William-De71/gladys-zwavejs/commit/c411cbe8e3f816786a0343f08a17573707dc04cb))

[1.9.0]: https://github.com/William-De71/gladys-zwavejs/compare/v1.8.0...v1.9.0
[1.8.0]: https://github.com/William-De71/gladys-zwavejs/releases/tag/v1.8.0
