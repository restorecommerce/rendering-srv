# syntax = docker/dockerfile:experimental

### Base
FROM node:12.18.3-alpine as base

RUN --mount=type=cache,uid=1000,gid=1000,target=/home/node/.npm npm install -g typescript@3.4.1

USER node
ARG APP_HOME=/home/node/srv
WORKDIR $APP_HOME

COPY package.json package.json
COPY package-lock.json package-lock.json


### Build
FROM base as build

RUN --mount=type=cache,uid=1000,gid=1000,target=/home/node/.npm npm ci

COPY --chown=node:node . .

RUN npm run build


### Deployment
FROM base as deployment

RUN --mount=type=cache,uid=1000,gid=1000,target=/home/node/.npm npm ci --only=production

COPY setupTopics.js $APP_HOME/setupTopics.js
COPY cfg $APP_HOME/cfg
COPY --from=build $APP_HOME/lib $APP_HOME/lib

EXPOSE 50051
HEALTHCHECK CMD npm run healthcheck
CMD [ "npm", "start" ]
