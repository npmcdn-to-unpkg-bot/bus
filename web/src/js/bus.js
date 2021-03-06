// bus is our controller for the bus application. It handles drawing to the
// screen and managing objects.
var StopGroups = require("./stop_groups.js");
var util = require("./util.js");
var Stop = require("./stop.js");
var Route = require("./route.js");
var Trip = require("./trip.js");
var LayerZoom = require("./layer_zoom.js");
var isMobile = require("ismobilejs");
var bus = new Bus();

var youAreHere = L.icon({
    iconUrl: 'img/here_blue3.svg',
    iconSize: [30, 30]
});

var homeControl = L.Control.extend({
    options: {
        position: 'bottomright'
    },

    onAdd: function(map) {
        return $("<button id='geolocate' type='button' class='btn btn-default btn-bus' onclick='getbus().geolocate();'><img src='img/gps_solid.svg' height='20' width='20'></button>")[0];
    }

});

var reloadControl = L.Control.extend({
    options: {
        position: 'bottomright'
    },

    onAdd: function(map) {
        return $("<button id='reload' type='button' class='btn btn-default btn-bus' onclick='getbus().reload();'><img src='img/reload.svg' height='20' width='20'></button>")[0];
    }

});



function Bus() {
    var self = this;

    // When at a close zoom level, we don't use a route type filter
    var nofilter = [];

    // At a wider level, we only want trains (0-2) and ferrys (4)
    var highfilter = [0, 1, 2, 4];

    // See if we stored our last location in local storage
    var initialLat = localStorage.getItem("lat");
    var initialLon = localStorage.getItem("lon");

    // default location when there are no results or we never visited
    // before
    self.timesSquare = {
        lat: 40.758895,
        lon: -73.9873197,
    };

    // If we didn't, default to Times Square
    if (!(initialLat && initialLon)) {
        initialLat = self.timesSquare.lat;
        initialLon = self.timesSquare.lon;
    }

    if (isMobile.any) {
        self.defaultZoom = 15;
    } else {
        self.defaultZoom = 16;
    }

    self.maxZoom = 18;
    self.minZoom = 10;

    // JSON-encoded Bloom filter (of routes that we have loaded) as returned by
    // "here" API. Send this back to each "here" request for an update.
    self.filter = '';

    // tileURL is passed to Leaflet JS for drawing the map
    self.tileURL = 'https://stamen-tiles-{s}.a.ssl.fastly.net/toner-lite/{z}/{x}/{y}.png';

    // tileOptions is passed to Leatlef JS for drawing the map
    self.tileOptions = {
        maxZoom: self.maxZoom,
        minZoom: self.minZoom,
        opacity: 1.0,
    };

    // mapOptions is the initial options sent on creation of the map
    self.mapOptions = {
        maxZoom: self.maxZoom,
        minZoom: self.minZoom,
        zoom: self.defaultZoom,
        closePopupOnClick: false,
        attributionControl: false,

        center: [initialLat, initialLon]
    };

    // zoomRouteTypes maps zoom levels to the route types they should send
    self.zoomRouteTypes = {
        10: highfilter,
        11: highfilter,
        12: highfilter,
        13: highfilter,
        14: nofilter,
        15: nofilter,
        16: nofilter,
        17: nofilter,
        18: nofilter,
    };

    // map is our Leaflet JS map object
    self.map = null;

    // stop groups is a mapping of unique ids that groups
    // stops together (e.g., NQR going nw)
    self.stopGroups = new StopGroups([]);

    // routes is a mapping from route's unique id to route object
    self.routes = {};

    // rows is stop unique ids mapped to rows in the results table
    self.rows = {};

    // group_rows is stopgroup key mapped to rows in results table 
    self.group_rows = {};

    // trip is a mapping from trip's unique id to trip object
    self.trips = {};

    // current_stop is current stop that is clicked
    self.current_stop = null;
    self.current_stop_group = null;

    // The current clicked trip
    self.clickedTripLayer = L.featureGroup();

    // Layer of stops on the current clicked trip
    self.stopLayer = L.featureGroup();
    self.busStopLayer = L.featureGroup();

    // Layer of vehicles on the current clicked trip
    self.vehicleLayer = L.featureGroup();

    // Train route shapes
    self.trainRouteLayer = L.featureGroup();

    // Bus route shapes
    self.busRouteLayer = L.featureGroup();

    // Stop labels have to handle zooming / etc. differently because
    // popups act weird
    self.stopLabelsLayer = L.featureGroup();
    self.stopLabelsID = null;

    // layerZooms is a list of LayerZoom objects for each layer on our
    // map. Layers will also be brought to front in order, so "back"
    // layers should go toward the beginning of the list and "front"
    // layers toward the end.
    self.layerZooms = [];

    // true while updating
    self.updating = false;

    // We want to enable the map mover only after our first gelocation
    // request is executed.
    self.firstGeolocate = true;

    // The current inflight "here" req if any.
    self.here_req = {
        "foreground": null,
        "background": null
    };

    // Increment the request id so we don't display results for
    // oudated requests.
    self.here_req_id = {
        "foreground": null,
        "background": null
    };

    // We delay background request to make sure person stays at
    // location
    self.bg_timer = null;

    self.bg_alpha = 0.60;
    self.fg_alpha = 0.90;

    // always do black
    self.text_color = '#000000';

    self.dont_get = false;
}

// init is run when the page initially loads
Bus.prototype.init = function() {
    var self = this;

    self.map = L.map('map', self.mapOptions);

    // Add our tiles
    L.tileLayer(self.tileURL, self.tileOptions).addTo(self.map);

    // Create "you are here" marker
    self.marker = L.marker([0, 0], {
        icon: youAreHere
    });
    self.marker.addTo(self.map);

    // Add layers to map
    self.layerZooms.push(new LayerZoom(self.busRouteLayer, 14));
    self.layerZooms.push(new LayerZoom(self.trainRouteLayer, 0));
    self.layerZooms.push(new LayerZoom(self.stopLayer, 12));
    self.layerZooms.push(new LayerZoom(self.busStopLayer, 14));
    self.layerZooms.push(new LayerZoom(self.vehicleLayer, 12));
    self.layerZooms.push(new LayerZoom(self.clickedTripLayer, 0));

    self.map.addControl(new homeControl());
    self.map.addControl(new reloadControl());

    self.stopLabelsLayer.addTo(self.map);

    self.getInitialRoutes();

    self.geolocate();
};

Bus.prototype.updateStopLabels = function() {
    var self = this;
    var zoom = self.map.getZoom();

    // No current stop, clear and return
    if (self.current_stop == null) {
        self.stopLabelsID = "";
        self.stopLabelsLayer.clearLayers();
        return;
    }

    // "all", "firstlast", "everyother", "none"
    var level;
    if (self.current_stop.api.route_type_name == "bus") {
        // bus stops are more frequent so be more conservative
        if (zoom >= 17) {
            level = "all";
        } else if (zoom >= 15) {
            level = "everyother";
        } else if (zoom >= 10) {
            level = "firstlast";
        } else {
            level = "none";
        }
    } else {
        if (zoom >= 14) {
            level = "all";
        } else if (zoom >= 12) {
            level = "everyother";
        } else if (zoom >= 10) {
            level = "firstlast";
        } else {
            level = "none";
        }
    }

    var id = self.current_stop + "|" + level;

    // No change, nothing to do
    if (id == self.stopLabelsID) {
        return;
    }

    // Save for next time
    self.stopLabelsID = id;

    self.stopLabelsLayer.clearLayers();

    if (self.current_stop != null) {
        var stop = self.current_stop;
        var trip = self.trips[stop.api.agency_id + "|" + stop.api.departures[0].trip_id]
        var labels = trip.createLabels(stop.api);
        for (var i = 0; i < labels.length; i++) {
            // must be first or last index
            if (level == "firstlast") {
                if (i != 0 && i != labels.length - 1) {
                    continue;
                }
            } else if (level == "everyother") {
                // do even stops except that we always include the last one
                if ((i % 2 != 0) && (i != labels.length - 1)) {
                    continue;
                }
            } else if (level == "none") {
                continue
            }

            self.stopLabelsLayer.addLayer(labels[i]);
        }
    }
};

// updateLayers set the visibility and order of layers on each update
Bus.prototype.updateLayers = function() {
    var self = this;

    for (var i = 0; i < self.layerZooms.length; i++) {
        var lz = self.layerZooms[i];
        lz.setVisibility(self.map);
    }
};

Bus.prototype.initMover = function(geoSuccess) {
    var self = this;

    // After the first successful geolocation, set up the move
    // handlers.
    if (self.firstGeolocate) {
        // Set up event handler
        self.map.on("moveend", function() {
            self.getHere();
            if (self.dont_get == false) {
                self.updateStopLabels();
                self.updateLayers();
            }
            self.dont_get = false;
        });

        // If we succeeded in doing the geolocate, also set up the watcher
        if (geoSuccess && isMobile.any) {

            // Double check
            if (navigator.geolocation) {
                navigator.geolocation.watchPosition(
                    // Success
                    function(p) {
                        self.geoWatchSuccess(p);
                    },

                    // Error (don't need to do anything)
                    null,

                    // Options
                    {
                        enableHighAccuracy: isMobile.any
                    });
            }
        }

        // Only do this once
        self.firstGeolocate = false;
    }
};

Bus.prototype.geoWatchSuccess = function(p) {
    var self = this;

    // Save last known location
    localStorage.setItem("lat", p.coords.latitude);
    localStorage.setItem("lon", p.coords.longitude);

    // Set location of "you are here" and map view
    self.marker.setLatLng([p.coords.latitude, p.coords.longitude]);
};

Bus.prototype.geoSuccess = function(p) {
    var self = this;

    // Save last known location
    localStorage.setItem("lat", p.coords.latitude);
    localStorage.setItem("lon", p.coords.longitude);

    // Set location of "you are here" and map view
    self.marker.setLatLng([p.coords.latitude, p.coords.longitude]);
    self.map.setView([p.coords.latitude, p.coords.longitude], self.defaultZoom);

    // Remove updating screen
    $("#loading").css("visibility", "hidden");

    // Initialize mover, get results here and update results
    self.initMover(true);

    self.getHere();
};

Bus.prototype.geoFailure = function() {
    var self = this;

    // The request for location has failed, just get results wherever we were.
    $("#loading").css("visibility", "hidden");

    self.initMover(false);

    // Get last known location
    var initialLat = localStorage.getItem("lat");
    var initialLon = localStorage.getItem("lon");

    if (initialLat && initialLon) {
        self.map.setView([initialLat, initialLon], self.defaultZoom);
    }

    self.getHere();
};

// geolocate requests the location from the browser and sets the location
Bus.prototype.geolocate = function() {
    var self = this;

    if (self.current_stop != null) {
        self.stopUnselect(self.current_stop);
    }

    if (navigator.geolocation) {
        // Set updating screen
        $("#loading").css("visibility", "visible");

        navigator.geolocation.getCurrentPosition(
            function(p) {
                self.geoSuccess(p);
            },
            function(p) {
                self.geoFailure()
            }, {
                timeout: 10000,
                enableHighAccuracy: isMobile.any
            });

    } else {
        self.geoFailure();
    }
};

Bus.prototype.parseForeground = function(data) {
    var self = this;
    var stoplist = [];

    if (data.stops) {
        // Create a stop object for each result and save to our list
        for (var i = 0; i < data.stops.length; i++) {
            var s = new Stop(data.stops[i]);
            stoplist[i] = s;
        }

        self.stopGroups = new StopGroups(stoplist);

    } else {
        self.stopGroups = new StopGroups([]);

    }
};

Bus.prototype.parseBackground = function(data) {
    var self = this;

    if (data.routes) {
        for (var i = 0; i < data.routes.length; i++) {
            var r = new Route(data.routes[i]);
            self.routes[r.api.unique_id] = r;
        };
    }

    if (data.trips) {
        for (var i = 0; i < data.trips.length; i++) {
            var t = new Trip(data.trips[i]);
            self.trips[t.api.unique_id] = t;
        };
    }

    if (data.filter) {
        self.filter = JSON.stringify(data.filter);
    }
};

Bus.prototype.createGroupRow = function(sg) {
    var self = this;
    var now = new Date();
    var mins = parseInt((sg.min_departure - now) / 1000 / 60)


    var cellCSS = {
        "color": self.text_color,
        "background-color": util.hexToRGBA(sg.route_color, self.bg_alpha),
        "border-width": "5px",
        "border-style": "solid",
        "border-color": "#ffffff"
    }

    var row = $("<tr class='stopgrouprow'>");
    $(row).css(cellCSS);

    var td1 = $("<td class='sgdir'>" + "<img src='img/compass_plain.svg' style='transform: rotate(" + sg.compass_dir + "deg);' width=20 height=20></td>");
    var td2 = $("<td class='sgroutes'>" +
        "<span class='routenames'>" + sg.display_names + "</span>" +
        "<br>" +
        "<span class='stopname'>" + sg.stop_name + "</span>" +
        "</td>");
    var td4;
    if (mins < 1) {
        td4 = $("<td class='sgmin'>now</td>");
    } else {
        td4 = $("<td class='sgmin'>" + mins + " min</td>");
    }

    $(row).append(td1);
    $(row).append(td2);
    $(row).append(td4);

    return row;
};

// createRow creates a results row for this stop
Bus.prototype.createRow = function(stop, sg) {
    var self = this;

    var headsign_style;
    if (sg.stops.length > 1) {
        headsign_style = stop.api.route_and_headsign;
    } else {
        headsign_style = stop.api.just_headsign;
    }

    var cellCSS = {
        "color": self.text_color,
        "background-color": util.hexToRGBA(stop.api.route_color, self.bg_alpha),
        "border-width": "5px",
        "border-style": "solid",
        "border-color": "#ffffff"

    };

    // Create our row object
    var row = $("<tr class='stoprow'>");
    $(row).css(cellCSS);

    var live = $("<td>");
    var datatd = $("<td colspan='2'>");
    var headsign = $('<span class="headsign">' +
        headsign_style +
        '</span>');
    var departures = $('<span><br>' + stop.departures + '</span>');
    $(datatd).append(headsign);
    $(datatd).append(departures);
    $(row).hide();

    if (stop.live) {
        $(live).append("<span class='live'>LIVE</span>");
    }

    $(row).append(live);
    $(row).append(datatd);


    return row;
};

// createEmptyRow creates a single empty row indicating there are
// no stops on the map
Bus.prototype.createEmptyRow = function() {
    var self = this;

    var cellCSS = {
        "color": "#222222",
        "background-color": "#ffffff",
        "opacity": 1.0,
    };

    var row = $("<tr>");
    var td = $("<td>");
    var a = $("<a href='#'>Times Square</a>").click(function() {
        self.map.setView([self.timesSquare.lat, self.timesSquare.lon], self.defaultZoom);
        self.getHere();

        return false;
    });

    $(td).append("<br>No departures in this area. Try ");
    $(td).append(a);
    $(td).append("?<br><br><br>");
    $(row).css(cellCSS);
    $(row).append(td);

    return row;
};

Bus.prototype.createAboutRow = function(colspan) {
    var cellCSS = {
        "color": "#222222",
        "background-color": "#ffffff",
        "opacity": 1.0,
        "text-align": "center",
    };

    var year = new Date().getFullYear();

    var row = $("<tr><td colspan=" + colspan + "><br><img height='40' height='137' src='img/token_typelogo_white_big_rgb.png'><br><span style='color:#EE0034'>beta</span><br><br>&copy; " + year + " <a href='https://www.brnstz.com'>Brian Seitz</a> <br><br>Data sources: <a href='http://www.mta.info/'>MTA</a>, <a href='http://www.njtransit.com/'>NJ Transit</a>, <a href='http://www.nyc.gov/html/dot/html/home/home.shtml'>NYC DOT</a>, <a href='http://www.panynj.gov/'>Port Authority of NY & NJ</a>.<br><br>Map tiles by <a href='http://stamen.com'>Stamen Design</a>, under <a href='http://creativecommons.org/licenses/by/3.0'>CC BY 3.0</a>. Data by <a href='http://openstreetmap.org'>OpenStreetMap</a>, under <a href='http://www.openstreetmap.org/copyright'>ODbL</a>.<br><br></td></tr>");

    $(row).css(cellCSS);

    return row
};

// getRoute returns a promise to get a route when it was a false positive in
// the bloom filter
Bus.prototype.getRoute = function(agency_id, route_id) {
    var self = this;

    var url = '/api/route' +
        '?agency_id=' + encodeURIComponent(agency_id) +
        '&route_id=' + encodeURIComponent(route_id);

    var promise = $.ajax(url, {
        dataType: "json"
    });

    promise.fail(function(xhr, text_status, error) {
        console.log("failed", xhr, text_status, error);
    });

    promise.done(function(data) {
        var r = new Route(data);
        self.routes[r.api.unique_id] = r;
    });

    return promise;
};

// getTrip returns a promise to get a trip when it was a false 
// positive in the bloom filter
Bus.prototype.getTrip = function(agency_id, route_id, trip_id, fallback_trip_id) {
    var self = this;

    var url = '/api/trip' +
        '?agency_id=' + encodeURIComponent(agency_id) +
        '&route_id=' + encodeURIComponent(route_id) +
        '&trip_id=' + encodeURIComponent(trip_id) +
        '&fallback_trip_id=' + encodeURIComponent(fallback_trip_id);

    var promise = $.ajax(url, {
        dataType: "json"
    });

    promise.fail(function(xhr, text_status, error) {
        console.log("failed", xhr, text_status, error);
    });

    promise.done(function(data) {
        var t = new Trip(data);
        // FIXME: since we may be getting a different trip id due
        // to live data, save it under the originally
        // requested key. but this is pretty ugly.
        //self.trips[t.api.unique_id] = t;
        self.trips[agency_id + "|" + trip_id] = t;
    });

    return promise;
};

// do everything need to select a group
Bus.prototype.groupSelect = function(sg) {
    var self = this;

    sg.expanded = true;

    // Set the currently selected group
    self.current_stop_group = sg;

    sg.expanded = true;

    self.groupHighlight(sg);

    // Look at each stop
    for (var i = 0; i < sg.stops.length; i++) {

        // Get the stop and its row
        var stop = sg.stops[i];
        var row = self.rows[stop.api.unique_id];

        // Show all stops for this group
        $(row).show(400);

        if (i == 0) {
            $(row).css({
                "border-top": "0",
                "border-bottom": "0"
            });
        } else {
            $(row).css({
                "border-top-width": "1px",
                "border-top-color": "#aaaaaa",
                "border-top-style": "solid",
                "border-bottom": "0"
            });

        }

        // And select the first stop
        if (i == 0) {
            self.stopSelect(stop);
        }
    }

    // Unselect all others
    for (var i = 0; i < self.stopGroups.keys.length; i++) {
        var key = self.stopGroups.keys[i];
        var this_sg = self.stopGroups.groups[key];

        if (this_sg != sg) {
            self.groupUnselect(this_sg);
        }
    }
}

Bus.prototype.groupHighlight = function(sg) {
    var self = this;

    var group_row = self.group_rows[sg.key];
    var cellCSS = {
        "color": self.text_color,
        "background-color": util.hexToRGBA(sg.route_color, self.fg_alpha),

        "border-bottom-width": "1px",
        "border-bottom-color": "#222222",
        "border-bottom-style": "solid"
    };
    $(group_row).css(cellCSS);
}

Bus.prototype.groupUnselect = function(sg) {
    var self = this;

    var group_row = self.group_rows[sg.key];
    var cellCSS = {
        "color": self.text_color,
        "background-color": util.hexToRGBA(sg.route_color, self.bg_alpha)
    };
    $(group_row).css(cellCSS);

    // Look at each stop
    for (var i = 0; i < sg.stops.length; i++) {

        // Get the stop and its row
        var stop = sg.stops[i];
        var row = self.rows[stop.api.unique_id];

        if (stop == self.current_stop) {
            self.stopUnselect(stop);
        }
    }
}

Bus.prototype.groupUnexpand = function(sg) {
    var self = this;

    sg.expanded = false;

    var group_row = self.group_rows[sg.key];
    var cellCSS = {
        "color": self.text_color,
        "background-color": util.hexToRGBA(sg.route_color, self.bg_alpha)
    };
    $(group_row).css(cellCSS);

    // Look at each stop
    for (var i = 0; i < sg.stops.length; i++) {

        // Get the stop and its row
        var stop = sg.stops[i];
        var row = self.rows[stop.api.unique_id];

        // Hide all stops for this group
        $(row).hide(400);

        if (stop == self.current_stop) {
            self.stopUnselect(stop);
        }
    }
};

Bus.prototype.groupClickHandler = function(sg) {
    var self = this;

    return function(e) {
        if (sg.expanded) {
            self.groupUnexpand(sg);

        } else {
            self.groupSelect(sg);
        }

        self.updateStopLabels();
        self.updateLayers();
    };
};

Bus.prototype.stopSelect = function(stop) {
    var self = this;

    var route_promise;
    var trip_promise;

    if (!self.routes[stop.api.agency_id + "|" + stop.api.route_id]) {
        route_promise = self.getRoute(stop.api.agency_id, stop.api.route_id);
    } else {
        route_promise = $("<div>").promise();
    }

    if (!self.trips[stop.api.agency_id + "|" + stop.api.departures[0].trip_id]) {

        trip_promise = self.getTrip(stop.api.agency_id, stop.api.route_id, stop.api.departures[0].trip_id, stop.api.fallback_trip_id);
    } else {
        trip_promise = $("<div>").promise();
    }

    route_promise.done(function() {
        trip_promise.done(function() {

            var sg_key = self.stopGroups.getKey(stop);
            var sg = self.stopGroups.groups[sg_key];

            // Unselect all others
            for (var i = 0; i < self.stopGroups.keys.length; i++) {
                var key = self.stopGroups.keys[i];
                var this_sg = self.stopGroups.groups[key];

                for (var j = 0; j < this_sg.stops.length; j++) {
                    var this_stop = this_sg.stops[j];
                    if (this_stop != stop) {
                        self.stopUnselect(this_stop);
                    }
                }

                if (sg != this_sg) {
                    self.groupUnselect(this_sg);
                }
            }
            self.groupHighlight(sg);

            var route = self.routes[stop.api.agency_id + "|" + stop.api.route_id];
            var trip = self.trips[stop.api.agency_id + "|" + stop.api.departures[0].trip_id]
            var row = self.rows[stop.api.unique_id];
            var stops = trip.createStopMarkers(stop.api);
            var lines = trip.createLines(stop.api, route.api);
            var vehicles = stop.createVehicles(route.api);
            var cellCSS = {
                "color": self.text_color,
                "background-color": util.hexToRGBA(stop.api.route_color, self.fg_alpha)
            };

            $(row).css(cellCSS);

            // Clear previous layer elements
            self.clickedTripLayer.clearLayers();
            self.stopLayer.clearLayers();
            self.busStopLayer.clearLayers();
            self.vehicleLayer.clearLayers();

            // Add new elements

            // First and last stop goes on the clicked trip layer (so we always
            // see it). The first stop has two markers, so include 0 and 1
            if (stops.length > 1) {
                self.clickedTripLayer.addLayer(stops[0]);
                self.clickedTripLayer.addLayer(stops[1]);
                self.clickedTripLayer.addLayer(stops[stops.length - 1]);
            }

            // Draw lines 
            for (var i = 0; i < lines.length; i++) {
                self.clickedTripLayer.addLayer(lines[i]);
            }

            if (stop.api.route_type_name == "bus") {
                // Draw stops
                for (var i = 2; i < stops.length - 1; i++) {
                    self.busStopLayer.addLayer(stops[i]);
                }
            } else {
                // Draw stops
                for (var i = 2; i < stops.length - 1; i++) {
                    self.stopLayer.addLayer(stops[i]);
                }
            }

            // Draw vehicles
            for (var i = 0; i < vehicles.length; i++) {
                self.vehicleLayer.addLayer(vehicles[i]);
            }

            self.current_stop = stop;

            self.updateStopLabels();
            self.updateLayers();

            self.dont_get = true;
            self.map.setView([stop.api.lat, stop.api.lon], self.map.getZoom(), {
                animate: true,
                duration: 0.75,
            });

        });
    });
};

Bus.prototype.stopUnselect = function(stop) {
    var self = this;

    self.current_stop = null;

    var row = self.rows[stop.api.unique_id];
    var cellCSS = {
        "color": self.text_color,
        "background-color": util.hexToRGBA(stop.api.route_color, self.bg_alpha)
    };

    $(row).css(cellCSS);

    // Clear previous layer elements
    self.clickedTripLayer.clearLayers();
    self.stopLayer.clearLayers();
    self.busStopLayer.clearLayers();
    self.vehicleLayer.clearLayers();

    self.updateStopLabels();
    self.updateLayers();
}

// clickHandler highlights the marker and the row for this stop_id
Bus.prototype.clickHandler = function(stop) {
    var self = this;

    return function(e) {
        if (self.current_stop == stop) {
            self.stopUnselect(stop);
        } else {
            self.stopSelect(stop);
        }
    };

};

// updateStops runs any manipulation necessary after parsing stops
// into stopList
Bus.prototype.updateStops = function() {
    var self = this;
    var stop = null;

    // Reset rows
    self.rows = {};


    // Create new table
    var table = $("<table class='results'>");
    var tbody = $("<tbody>");
    var results = $("#results");

    for (var i = 0; i < self.stopGroups.keys.length; i++) {
        var key = self.stopGroups.keys[i];
        var sg = self.stopGroups.groups[key];
        var group_row = self.createGroupRow(sg);

        self.group_rows[key] = group_row;

        $(tbody).append(group_row);

        var group_handler = self.groupClickHandler(sg);
        $(group_row).click(group_handler);

        for (var j = 0; j < sg.stops.length; j++) {
            // create the stop row and stops
            stop = sg.stops[j];

            var row = self.createRow(stop, sg);

            // Put into row
            self.rows[stop.api.unique_id] = row;

            // Add to row display
            $(tbody).append(row);

            var handler = self.clickHandler(stop);
            $(row).click(handler);
        }
    }

    // If it's empty then add the empty row
    if (self.stopGroups.keys.length === 0) {
        $(tbody).append(self.createEmptyRow());
        $(tbody).append(self.createAboutRow(1));
    } else {
        $(tbody).append(self.createAboutRow(3));
    }

    // Destroy and recreate results
    $(table).append(tbody);
    $(results).empty();
    $(results).append(table);
    $(results).animate({
        "scrollTop": 0
    }, "fast");
};

Bus.prototype.updateRoutes = function() {
    var self = this;
    var layer = null;

    // Go through each route and add to appropriate layer
    // if it hasn't already been added.
    for (var key in self.routes) {
        var route = self.routes[key];

        if (route.api.route_type_name == "bus") {
            layer = self.busRouteLayer;
        } else {
            layer = self.trainRouteLayer;
        }

        for (var i = 0; i < route.routeLines.length; i++) {
            var line = route.routeLines[i];
            if (!layer.hasLayer(line)) {
                layer.addLayer(line);
            }
        }
    };
};

Bus.prototype.getInitialRoutes = function() {
    var self = this;

    var url = '/api/routes';

    $.ajax(url, {
        dataType: "json",
        success: function(data) {
            self.parseBackground(data);
            self.updateRoutes();
            self.updateLayers();
        },

        error: function(xhr, stat, err) {
            console.log("error executing routes request");
            console.log(xhr, stat, err);
        }
    });
};

Bus.prototype.reload = function() {
    var self = this;

    if (self.current_stop != null) {
        self.stopUnselect(self.current_stop);
    }

    self.getHere();
    self.updateStopLabels();
    self.updateLayers();
};

Bus.prototype.getHere = function() {
    var self = this;

    self.getHereAux("foreground");

    window.clearTimeout(self.bg_timer);
    self.bg_timer = window.setTimeout(function() {
        self.getHereAux("background");
    }, 2000);
};

// getHere calls the here API with our current state and updates
// the UI with the results
Bus.prototype.getHereAux = function(rtype) {
    var self = this;

    // Ensure that current stop still represents a route that
    // is on screen
    if (self.current_stop != null) {
        stop = self.current_stop;
        var route = self.routes[stop.api.agency_id + "|" + stop.api.route_id];
        var trip = self.trips[stop.api.agency_id + "|" + stop.api.departures[0].trip_id]
        var bounds = self.map.getBounds();

        if (!(route.onMap(bounds) || trip.onMap(bounds))) {
            self.stopUnselect(stop);
        } else {
            return;
        }
    }


    if (rtype == "foreground") {
        $("#loading").css("visibility", "visible");
    }


    // Abort any previous requests in flight
    if (self.here_req[rtype] != null) {
        self.here_req[rtype].abort();
    }

    // Update the here id
    self.here_req_id[rtype]++;
    var here_req_now = self.here_req_id[rtype];

    var center = self.map.getCenter();
    var bounds = self.map.getBounds();
    var sw = bounds.getSouthWest();
    var ne = bounds.getNorthEast();
    var routeTypes = self.zoomRouteTypes[self.map.getZoom()];

    var url = '/api/here' +
        '?lat=' + encodeURIComponent(center.lat) +
        '&lon=' + encodeURIComponent(center.lng) +
        '&sw_lat=' + encodeURIComponent(sw.lat) +
        '&sw_lon=' + encodeURIComponent(sw.lng) +
        '&ne_lat=' + encodeURIComponent(ne.lat) +
        '&ne_lon=' + encodeURIComponent(ne.lng) +
        '&filter=' + encodeURIComponent(self.filter);

    for (var i = 0; i < routeTypes.length; i++) {
        url += '&route_type=' + encodeURIComponent(routeTypes[i]);
    }

    if (rtype == "background") {
        url += "&routes=true&trips=true";
    }

    self.here_req[rtype] = $.ajax(url, {
        dataType: "json",

        success: function(data) {
            if (self.here_req_id[rtype] == here_req_now) {
                // If our request id is the most recent one, then
                // process the response and reset the request to null

                if (rtype == "foreground") {
                    self.parseForeground(data);
                    self.updateStops();

                } else {
                    self.parseBackground(data);
                    self.updateRoutes();

                }
                self.updateLayers();

                self.here_req[rtype] = null;

                if (rtype == "foreground") {
                    $("#loading").css("visibility", "hidden");
                }
            }

            // Otherwise, we ignore the response because we have 
            // something more recent in flight
        },

        error: function(xhr, stat, err) {
            if (self.here_req_id[rtype] == here_req_now) {

                // If our request id is the most recent one, then 
                // process the response

                // Usually this will be an abort request, but if it's
                // not then log the error
                if (err != "abort") {
                    console.log("error executing here request");
                    console.log(xhr, stat, err);
                    $("#loading").css("visibility", "hidden");
                }

                // Reset this to null though typically when this is the
                // result of abort, the primary request will immediately
                // reset this. But this seems to be the right thing to do.
                self.here_req[rtype] = null;
            }

            // Otherwise, we ignore the response because we have 
            // something more recent in flight
        }
    });
};

// initbus should be called by the windows to initialize the bus object
window.initbus = function() {
    bus.init();
};

// getbus allows you to retrieve the core bus object in the console for
// debugging
window.getbus = function() {
    return bus;
};
