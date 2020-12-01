# syntax = docker/dockerfile:experimental

### Base
FROM node:14.15.1-alpine as base
ENV NO_UPDATE_NOTIFIER=true
RUN npm install -g typescript@3.4.1

USER node
ARG APP_HOME=/home/node/srv
WORKDIR $APP_HOME

COPY package.json package.json
COPY package-lock.json package-lock.json


### Build
FROM base as build

RUN npm ci

COPY --chown=node:node . .

RUN npm run build


### Deployment
FROM base as deployment

RUN npm ci --only=production

COPY setupTopics.js $APP_HOME/setupTopics.js
COPY cfg $APP_HOME/cfg
COPY --from=build $APP_HOME/lib $APP_HOME/lib

EXPOSE 50051

USER root
RUN GRPC_HEALTH_PROBE_VERSION=v0.3.3 && \
    wget -qO/bin/grpc_health_probe https://github.com/grpc-ecosystem/grpc-health-probe/releases/download/${GRPC_HEALTH_PROBE_VERSION}/grpc_health_probe-linux-amd64 && \
    chmod +x /bin/grpc_health_probe
USER node

HEALTHCHECK CMD ["/bin/grpc_health_probe", "-addr=:50051"]
CMD [ "npm", "start" ]
