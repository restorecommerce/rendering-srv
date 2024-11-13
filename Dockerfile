### Build
FROM node:22.11.0-alpine3.20 as build
ENV NO_UPDATE_NOTIFIER=true

USER node
ARG APP_HOME=/home/node/srv
WORKDIR $APP_HOME

COPY package.json package.json
COPY package-lock.json package-lock.json

RUN npm ci

COPY --chown=node:node . .

RUN npm run build


### Deployment
FROM node:22.11.0-alpine3.20 as deployment

ENV NO_UPDATE_NOTIFIER=true

USER node
ARG APP_HOME=/home/node/srv
WORKDIR $APP_HOME

COPY package.json package.json
COPY package-lock.json package-lock.json

COPY --chown=node:node ./cfg $APP_HOME/cfg
COPY --chown=node:node --from=build $APP_HOME/lib $APP_HOME/lib
COPY --chown=node:node --from=build $APP_HOME/handlebars $APP_HOME/handlebars

EXPOSE 50051

USER root
USER node

CMD [ "node", "./lib/start.cjs" ]
