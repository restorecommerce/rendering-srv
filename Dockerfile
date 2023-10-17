### Base
FROM node:20.8.0-alpine3.18 as base
ENV NO_UPDATE_NOTIFIER=true

RUN apk add g++ make python3

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

COPY --chown=node:node . $APP_HOME
COPY --chown=node:node --from=build $APP_HOME/lib $APP_HOME/lib

EXPOSE 50051

USER root
USER node

CMD [ "npm", "start" ]
