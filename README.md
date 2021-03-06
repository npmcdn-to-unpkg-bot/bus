# bus

`bus` is an API that returns live and scheduled departures for
[MTA](http://www.mta.info/) bus and subway stops close to a given 
geolocation within a specified range.

[![Build Status](https://travis-ci.org/brnstz/bus.svg?branch=master)](https://travis-ci.org/brnstz/bus?branch=master)

*Alpha version in development:* https://bus.brnstz.com/

## Requirements

* Go 1.6+ and dependencies:
  * https://github.com/jmoiron/sqlx
  * https://github.com/lib/pq
  * https://github.com/fzzy/radix
  * https://github.com/kelseyhightower/envconfig
  * https://github.com/golang/protobuf
  * https://github.com/brnstz/upsert
* PostgreSQL 9.3+ with postgis
* Redis

## Supported routes

| Route                  | Scheduled | Live | 
|------------------------|-----------|------|
| 1 2 3                  | Yes       | Yes  |
| 4 5 6                  | Yes       | Yes  |
| 7                      | Yes       | No   |
| A C E                  | Yes       | No   |
| B D F M                | Yes       | No   |
| G                      | Yes       | No   |
| J Z                    | Yes       | No   |
| L                      | Yes       | Yes  |
| N Q R                  | Yes       | No   |
| S                      | Yes       | Yes  |
| Staten Island Railroad | Yes       | Yes  |
| Buses                  | Yes       | Yes  |


## Binaries

The full system consists of two binaries. Each binary can be configured
using environment variables and typically are run as daemons. They are both 
located under the `cmds/` directory.

## Shared Database Config

Since both binaries connect to the database, they share the following
config variables:

| Name           | Description                 | Default value    |
|----------------|-----------------------------|------------------|
| `BUS_DB_ADDR`  | `host:port` of postgres     | `localhost:5432` |
| `BUS_DB_USER`  | The username to use         | `postgres`       |
| `BUS_DB_NAME`  | The database name to use    | `postgres`       |

## `busapi`

`busapi` is the queryable API. 

### Config

| Name                        | Description                            | Default value     |
|-----------------------------|----------------------------------------|-------------------|
| `BUS_API_ADDR`              | `host:port` to listen on               | `0.0.0.0:8000`          |
| `BUS_REDIS_ADDR`            | `host:port` of redis                   | `localhost:6379`  |
| `BUS_MTA_BUSTIME_API_KEY`   |  API key for http://bustime.mta.info/  | *None*            |
| `BUS_MTA_DATAMINE_API_KEY`  |  API key for http://datamine.mta.info/ | *None*            |

### `/api/v2/stops` Endpoint

### Query Parameters

| Name     | Description                                     | Example     | Required | 
|----------|-------------------------------------------------|-------------|----------|
| lat      | The latitude of the requested location          | `40.729183` | Yes      |
| lon      | The longitude of the requested location         | `-73.95154` | Yes      |
| miles    | The maximum radius to search                    | `0.5`       | Yes      |
| filter   | Filter results by either `subway` or `bus` only | `subway`    | No       |


### Example

```bash
curl 'http://localhost:8000/api/v2/stops?lat=40.729183&lon=-73.95154&miles=0.5&filter=subway' 
```

```json
{
    "results": [
        {
            "departures": {
                "live": null,
                "scheduled": [
                    { "time": "2016-05-01T21:10:00-04:00" },
                    { "time": "2016-05-01T21:22:00-04:00" },
                    { "time": "2016-05-01T21:34:00-04:00" }
                ]
            },
            "dist": 344.2649351427617,
            "route": {
                "route_color": "6CBE45",
                "route_id": "G",
                "route_text_color": "000000",
                "route_type": 1,
                "route_type_name": "subway"
            },
            "stop": {
                "direction_id": 0,
                "headsign": "COURT SQ",
                "lat": 40.731352,
                "lon": -73.954449,
                "route_id": "G",
                "stop_id": "G26N",
                "stop_name": "Greenpoint Av"
            }
        },
        {
            "departures": {
                "live": null,
                "scheduled": [
                    { "time": "2016-05-01T21:13:00-04:00" },
                    { "time": "2016-05-01T21:25:00-04:00" },
                    { "time": "2016-05-01T21:37:00-04:00" }
                ]
            },
            "dist": 344.2649351427617,
            "route": {
                "route_color": "6CBE45",
                "route_id": "G",
                "route_text_color": "000000",
                "route_type": 1,
                "route_type_name": "subway"
            },
            "stop": {
                "direction_id": 1,
                "headsign": "CHURCH AV",
                "lat": 40.731352,
                "lon": -73.954449,
                "route_id": "G",
                "stop_id": "G26S",
                "stop_name": "Greenpoint Av"
            }
        }
    ]
}
```

## `busloader`

`busloader` downloads 
[GTFS](https://developers.google.com/transit/gtfs/) files and loads
them to the database. Typically, these files are updated periodically
from a well-known URL. The loader incorporates these updates to the 
database without losing old values.

### Config

| Name                        | Description                                                                              | Default value       |
|-----------------------------|------------------------------------------------------------------------------------------|---------------------|
| `BUS_TMP_DIR`               | Path to temporary directory                                                              |`os.TempDir()`       |
| `BUS_GTFS_URLS`             | Comma-separated path to GTFS zip URLs                                                   | *None*              |
| `BUS_ROUTE_FILTER`          | Comma-separated list of `route_id` values to filter on (i.e., *only* load these routes)  | *None (no filter)*  |
| `BUS_LOAD_FOREVER`          | Load forever (24 hour delay between loads) if `true`, exit after first load if `false`   |  `true`             |

### Example

```bash
# Load only the G and L train info and exit after initial load
export BUS_GTFS_URLS="http://web.mta.info/developers/data/nyct/subway/google_transit.zip"
export BUS_ROUTE_FILTER="G,L"
export BUS_LOAD_FOREVER="false"
busloader 
```

## Automation

In the `automation/` directory, there is a sample of how to fully deploy the
system. A full configuration for a deploy consists of an inventory file and a
`group_vars/` file. The included config is called `inventory_vagrant`. For 
security reasons (the API keys), the vars are encrypted in this repo. You can
create your own config and deploy it locally by doing the following:

```bash

# Create vagrant server
$ cd automation/vagrant
$ vagrant up
$ cd ../..

# Overwrite group vars with defaults
$ cd automation/group_vars
$ cp defaults.yml inventory_vagrant.yml

# Add your API keys
$ vim inventory_vagrant.yml
$ cd ../..

# Deploy the system
$ cd automation
$ ./build.sh && ./deploy.sh inventory_vagrant db.yml api.yml web.yml loader.yml

# If all goes well, system is available on http://localhost:8000
```
