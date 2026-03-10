/**
 * OpenMCT plugin: Gauss telemetry from Feed/API.
 * Polls /api/feed/space-weather/latest and exposes speed, density, bz as realtime telemetry.
 */
(function (openmct) {
  const GAUSS_NAMESPACE = "gauss.telemetry";
  const GAUSS_TYPE = "gauss.spaceWeather";

  function GaussTelemetryPlugin(apiBase) {
    return function install(openmct) {
      openmct.types.addType(GAUSS_TYPE, {
        name: "Gauss Space Weather",
        key: GAUSS_TYPE,
        description: "Space weather feed from Gauss Feed/API",
        creatable: true,
        cssClass: "icon-telemetry",
      });

      openmct.telemetry.addProvider({
        key: "gauss.realtime",
        name: "Gauss Realtime",
        supportsRequest: function (domainObject) {
          return domainObject.type === GAUSS_TYPE;
        },
        request: function (domainObject, options) {
          return fetch(apiBase + "/api/feed/space-weather/latest", {
            headers: options.headers || {},
          })
            .then(function (r) {
              return r.json();
            })
            .then(function (data) {
              var timestamp = new Date(data.timestamp || Date.now()).getTime();
              var sw = data.solarWind || {};
              var b = data.magneticField || {};
              return [
                {
                  timestamp: timestamp,
                  speed: sw.speed,
                  density: sw.density,
                  bz: b.z,
                },
              ];
            })
            .catch(function () {
              return [];
            });
        },
        supportsSubscribe: function (domainObject) {
          return domainObject.type === GAUSS_TYPE;
        },
        subscribe: function (domainObject, callback) {
          var interval = setInterval(function () {
            fetch(apiBase + "/api/feed/space-weather/latest")
              .then(function (r) {
                return r.json();
              })
              .then(function (data) {
                var timestamp = new Date(data.timestamp || Date.now()).getTime();
                var sw = data.solarWind || {};
                var b = data.magneticField || {};
                callback({
                  timestamp: timestamp,
                  speed: sw.speed,
                  density: sw.density,
                  bz: b.z,
                });
              })
              .catch(function () {});
          }, 5000);
          return function unsubscribe() {
            clearInterval(interval);
          };
        },
      });

      openmct.objects.addRoot({
        namespace: GAUSS_NAMESPACE,
        key: "space-weather",
      });

      openmct.objects.addProvider(GAUSS_NAMESPACE, {
        get: function (identifier) {
          if (identifier.key === "space-weather") {
            return Promise.resolve({
              identifier: identifier,
              name: "Gauss Space Weather",
              type: GAUSS_TYPE,
              telemetry: {
                values: [
                  { key: "speed", name: "Solar wind speed", unit: "km/s", format: "float" },
                  { key: "density", name: "Density", unit: "cm^-3", format: "float" },
                  { key: "bz", name: "Bz", unit: "nT", format: "float" },
                ],
              },
            });
          }
          return Promise.reject();
        },
      });
    };
  }

  openmct.plugins.GaussTelemetry = GaussTelemetryPlugin;
})(window.openmct);
