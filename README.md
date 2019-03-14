# rendering-srv
<img src="http://img.shields.io/npm/v/%40restorecommerce%2Frendering%2Dsrv.svg?style=flat-square" alt="">[![Build Status][build]](https://travis-ci.org/restorecommerce/rendering-srv?branch=master)[![Dependencies][depend]](https://david-dm.org/restorecommerce/rendering-srv)[![Coverage Status][cover]](https://coveralls.io/github/restorecommerce/rendering-srv?branch=master)

[version]: http://img.shields.io/npm/v/rendering-srv.svg?style=flat-square
[build]: http://img.shields.io/travis/restorecommerce/rendering-srv/master.svg?style=flat-square
[depend]: https://img.shields.io/david/restorecommerce/rendering-srv.svg?style=flat-square
[cover]: http://img.shields.io/coveralls/restorecommerce/rendering-srv/master.svg?style=flat-square

A microservice which renders HTML output from [Handlebars](http://handlebarsjs.com/) templates. Additionally, a stylesheet URL can be provided.
Rendering is performed using [handlebars-helperized](https://github.com/restorecommerce/handlebars-helperized), a module which has several custom helpers for handlebars.
All requests and responses are issued via [Apache Kafka](https://kafka.apache.org/) and their message structures are defined in the [rendering.proto](https://github.com/restorecommerce/protos/blob/master/io/restorecommerce/rendering.proto) file.
This service is based on event-driven communication, using [kafka-client](https://github.com/restorecommerce/kafka-client), which binds listeners to specific Kafka events.

## Kafka Events

This microservice subscribes to the following Kafka events by topic:
- io.restorecommerce.rendering
  - renderRequest
- io.restorecommerce.command
  - healthCheckCommand

List of events emitted to Kafka by this microservice for below topics:
- io.restorecommerce.rendering
  - renderResponse
  - renderResponse
- io.restorecommerce.command
  - healthCheckResponse


### Event Messages

#### RenderRequest

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
| style | string | optional | A URL pointing to a stylesheet |
| strategy | enum | optional | Strategy to use for applying the stylesheet. Possible values are `INLINE` and `COPY`|


`io.restorecommerce.rendering.RenderResponse`

| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| id | string | required | Same value as the respective `RenderRequest` id |
| response | [ ] `io.restorecommerce.rendering.Response` | required | List of rendered outputs |


`io.restorecommerce.rendering.Response`

| Field | Type | Label | Description |
| ----- | ---- | ----- | ----------- |
| content | string | required | JSON mapping of template labels to rendered output |

## Chassis Service

This service uses [chassis-srv](http://github.com/restorecommerce/chassis-srv), a base module for [restorecommerce](https://github.com/restorecommerce) microservices, in order to provide the following functionalities:

- implementation of a [command-interface](https://github.com/restorecommerce/chassis-srv/blob/master/command-interface.md) which provides endpoints for retrieving the system status and version information. These endpoints can be called via [gRPC](https://grpc.io/docs/) or Kafka events (through the `io.restorecommerce.command` topic).
- stores the offset values for Kafka topics at regular intervals to [Redis](https://redis.io/).


## Development

### Tests

See [tests](https://github.com/restorecommerce/rendering-srv/tree/master/test).


## Usage

### Development

- Install dependencies

```sh
npm install
```

- Build application

```sh
# compile the code
npm run build
```

- Run application and restart it on changes in the code

```sh
# Start rendering-srv backend in dev mode
npm run dev
```

### Production

```sh
# compile the code
npm run build

# run compiled server
npm start
```