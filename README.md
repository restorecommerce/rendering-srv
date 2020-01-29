# rendering-srv
[![Build Status][build]](https://travis-ci.org/restorecommerce/rendering-srv?branch=master)[![Dependencies][depend]](https://david-dm.org/restorecommerce/rendering-srv)[![Coverage Status][cover]](https://coveralls.io/github/restorecommerce/rendering-srv?branch=master)

[build]: http://img.shields.io/travis/restorecommerce/rendering-srv/master.svg?style=flat-square
[depend]: https://img.shields.io/david/restorecommerce/rendering-srv.svg?style=flat-square
[cover]: http://img.shields.io/coveralls/restorecommerce/rendering-srv/master.svg?style=flat-square

A microservice which renders HTML output from [Handlebars](http://handlebarsjs.com/) templates. Additionally, a stylesheet URL can be provided.
Rendering is performed using [handlebars-helperized](https://github.com/restorecommerce/handlebars-helperized), a module which has several custom helpers for handlebars.
All requests and responses are issued via [Apache Kafka](https://kafka.apache.org/) and their message structures are defined in the [rendering.proto](https://github.com/restorecommerce/protos/blob/master/io/restorecommerce/rendering.proto) file.
This service is based on event-driven communication, using [kafka-client](https://github.com/restorecommerce/kafka-client), which binds listeners to specific Kafka events.

## Kafka Events

This microservice subscribes to the following events by topic:

| Topic Name | Event Name | Description |
| ----------- | ------------ | ------------- |
| `io.restorecommerce.rendering` | `renderRequest` | to receive render request |
| `io.restorecommerce.command`   | `healthCheckCommand` | to get system health check |

List of events emitted by this microservice for below topics:

| Topic Name | Event Name | Description |
| ----------- | ------------ | ------------- |
| `io.restorecommerce.rendering` | `renderResponse` | emitted when request is rendered  |
| `io.restorecommerce.command`   | `healthCheckResponse` | system health check response |


### Event Messages

#### `RenderRequest`

`io.restorecommerce.rendering.RenderRequest`

| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| id | string | required | Request ID |
| payload | [ ] `io.restorecommerce.rendering.Payload` | required | List of templates and data |
| service_name | string | optional | Requester label |

`io.restorecommerce.rendering.Payload`

| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| templates | string | required | JSON mapping labels to body and layout templates |
| data | string | required | JSON mapping content to render output |
| content_type | string | required | content type for rendering ex: 'application/html' or 'application/text' |
| style_url | string | optional | A URL pointing to a stylesheet |
| strategy | enum | optional | Strategy to use for applying the stylesheet. Possible values are `INLINE` and `COPY`|

#### `RenderResponse`

`io.restorecommerce.rendering.RenderResponse`

| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| id | string | required | Same value as the respective `RenderRequest` id |
| response | [ ] `io.restorecommerce.rendering.Response` | required | List of rendered outputs |


`io.restorecommerce.rendering.Response`

| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| content | string | required | JSON mapping of template labels to rendered output |
| content_type | string | required | content-type ex: 'application\html' or 'application\text' |

## Chassis Service

This service uses [chassis-srv](http://github.com/restorecommerce/chassis-srv), a base module for [restorecommerce](https://github.com/restorecommerce) microservices, in order to provide the following functionalities:

- implementation of a [command-interface](https://github.com/restorecommerce/chassis-srv/blob/master/command-interface.md) which provides endpoints for retrieving the system status and version information. These endpoints can be called via [gRPC](https://grpc.io/docs/) or Kafka events (through the `io.restorecommerce.command` topic).
- stores the offset values for Kafka topics at regular intervals to [Redis](https://redis.io/).


## Development

### Tests

See [tests](test/). To execute the tests a running instance of [Kafka](https://kafka.apache.org/) and [Redis](https://redis.io/) are needed.
Refer to [System](https://github.com/restorecommerce/system) repository to start the backing-services before running the tests.

- To run tests

```sh
npm run test
```


## Running as Docker Container

This service depends on a set of _backing services_ that can be started using a
dedicated [docker compose definition](https://github.com/restorecommerce/system).

```sh
docker run \
 --name restorecommerce_rendering_srv \
 --hostname rendering-srv \
 --network=system_test \
 -e NODE_ENV=production \
 -p 50057:50057 \
 restorecommerce/rendering-srv
```

## Running Locally

Install dependencies

```sh
npm install
```

Build service

```sh
# compile the code
npm run build
```

Start service

```sh
# run compiled service
npm start
```