FROM node:14.15.5-stretch
ENV HOME=/home/node
ENV APP_HOME=/home/node/rendering-srv
ENV NO_UPDATE_NOTIFIER=true
RUN npm install -g npm
## SETTING UP THE APP ##
RUN mkdir $APP_HOME
WORKDIR $APP_HOME
RUN cd $APP_HOME
# Bundle app source
COPY . $APP_HOME
# Chown all the files to the node user.
RUN chown -R node:node $HOME
RUN pwd
# switch to the node user.
USER node
RUN npm install
RUN npm run build
EXPOSE 50051
USER root
RUN GRPC_HEALTH_PROBE_VERSION=v0.3.3 && \
    wget -qO/bin/grpc_health_probe https://github.com/grpc-ecosystem/grpc-health-probe/releases/download/${GRPC_HEALTH_PROBE_VERSION}/grpc_health_probe-linux-amd64 && \
    chmod +x /bin/grpc_health_probe
USER node
HEALTHCHECK CMD ["/bin/grpc_health_probe", "-addr=:50051"]
CMD [ "npm", "start" ]
